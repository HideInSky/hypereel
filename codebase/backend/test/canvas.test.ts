import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FakeProvider } from "../src/services/comfy.js";
import { imageGraph } from "../src/services/workflows.js";
import { db, multipart, testApp, tinyJpeg, waitFor } from "./helpers.js";
import { PROMPT_MAX } from "../src/textLimits.js";

beforeEach(async () => {
  await db.generation.deleteMany();
  await db.sequence.deleteMany();
  await db.asset.deleteMany();
  await db.canvas.deleteMany();
});
afterAll(async () => { await db.$disconnect(); });

type App = Awaited<ReturnType<typeof testApp>>["app"];
const cookieOf = (res: { headers: Record<string, unknown> }) => String(res.headers["set-cookie"]).split(";")[0]!;

async function newCanvas(app: App) {
  const res = await app.inject({ method: "POST", url: "/api/canvases", payload: { title: "Dance video" } });
  return { canvas: res.json(), cookie: cookieOf(res), status: res.statusCode };
}

async function upload(app: App, id: string, cookie: string, kind: string, count = 1) {
  const files = await Promise.all(Array.from({ length: count }, async (_, i) => ({ name: "photo", data: await tinyJpeg(), filename: `p${i}.jpg` })));
  const body = multipart({ kind, name: kind === "character" ? "Mia" : "Stage" }, files);
  return app.inject({ method: "POST", url: `/api/canvases/${id}/assets`, payload: body.payload, headers: { ...body.headers, cookie } });
}

const getCanvas = async (app: App, id: string, cookie?: string) =>
  (await app.inject({ method: "GET", url: `/api/canvases/${id}`, headers: cookie ? { cookie } : {} })).json();

const idle = (app: App, id: string, cookie: string) =>
  waitFor(async () => {
    const c = await getCanvas(app, id, cookie);
    const busy = [...c.assets, ...c.videos].some((x: { status: string }) => x.status === "queued" || x.status === "running");
    return busy ? undefined : c;
  }, 20_000);

describe("canvas", () => {
  it("uploads a character, makes a sheet and an image, makes a video from them, and grows it into a story", async () => {
    const { app } = await testApp({ LIMIT_PER_SESSION_PER_HOUR: "20" }, new FakeProvider(10));
    const { canvas, cookie, status } = await newCanvas(app);
    expect(status).toBe(201);
    expect(canvas.isOwner).toBe(true);

    const mia = (await upload(app, canvas.id, cookie, "character", 2)).json();
    const character = mia.assets[0];
    expect(character.images).toHaveLength(2);
    expect(mia.board.cards).toHaveLength(1);

    const sheet = await app.inject({ method: "POST", url: `/api/canvases/${canvas.id}/assets/${character.id}/sheet`, headers: { cookie } });
    expect(sheet.statusCode).toBe(202);
    const stage = await app.inject({ method: "POST", url: `/api/canvases/${canvas.id}/assets/generate`, payload: { kind: "image", prompt: "an empty theatre stage under a spotlight" }, headers: { cookie } });
    expect(stage.statusCode).toBe(202);
    const ready = await idle(app, canvas.id, cookie);
    const sheetAsset = ready.assets.find((a: { kind: string }) => a.kind === "sheet");
    const stageAsset = ready.assets.find((a: { kind: string }) => a.kind === "image");
    expect(sheetAsset.status).toBe("succeeded");
    expect(sheetAsset.sources).toEqual([character.id]);
    expect(ready.board.cards).toHaveLength(3);
    // The sheet sits to the right of the character it came from.
    const card = (ref: string) => ready.board.cards.find((c: { refId: string }) => c.refId === ref);
    expect(card(sheetAsset.id).x).toBeGreaterThan(card(character.id).x);

    const video = await app.inject({
      method: "POST", url: `/api/canvases/${canvas.id}/videos`, headers: { cookie },
      payload: { prompt: "She dances on the stage", characters: [character.id, sheetAsset.id], locations: [stageAsset.id], seconds: 6 },
    });
    expect(video.statusCode).toBe(202);
    const done = await idle(app, canvas.id, cookie);
    const clip = done.videos[0];
    expect(clip.status).toBe("succeeded");
    expect(clip.effectLabel).toBe("Video");
    expect(clip.assetIds.sort()).toEqual([character.id, sheetAsset.id, stageAsset.id].sort());
    const row = await db.generation.findUniqueOrThrow({ where: { id: clip.id } });
    expect(row.prompt).toContain("Image 1, Image 2 and Image 3 show the character");
    expect(row.prompt).toContain("Image 4 shows the location");
    expect(row.prompt).toContain("She dances on the stage.");

    const story = await app.inject({ method: "POST", url: `/api/canvases/${canvas.id}/videos/${clip.id}/story`, headers: { cookie } });
    const again = await app.inject({ method: "POST", url: `/api/canvases/${canvas.id}/videos/${clip.id}/story`, headers: { cookie } });
    expect(again.json().storyId).toBe(story.json().storyId);
    expect((await getCanvas(app, canvas.id, cookie)).videos[0].storyId).toBe(story.json().storyId);

    // With a story beside the video, a new card never lands in that row.
    const shot = multipart({ anchorId: clip.id, side: "after", mode: "continue" });
    await app.inject({ method: "POST", url: `/api/sequences/${story.json().storyId}/shots`, payload: shot.payload, headers: { ...shot.headers, cookie } });
    const later = (await upload(app, canvas.id, cookie, "image")).json();
    const videoCard = later.board.cards.find((c: { refId: string }) => c.refId === clip.id);
    expect(later.board.cards.at(-1).y).toBeGreaterThan(videoCard.y);

    const list = (await app.inject({ method: "GET", url: "/api/canvases", headers: { cookie } })).json();
    expect(list).toHaveLength(1);
    expect(list[0].cover).toMatch(/^\/media\//);
    await app.close();
  }, 60_000);

  it("moves cards but never lets the client add or drop them, and only the owner edits", async () => {
    const { app } = await testApp({}, new FakeProvider(10));
    const { canvas, cookie } = await newCanvas(app);
    const withAsset = (await upload(app, canvas.id, cookie, "image")).json();
    const real = withAsset.board.cards[0];
    const board = { viewport: { x: 10, y: 20, zoom: 0.5 }, cards: [{ ...real, x: 900, y: 450 }, { id: "fake", kind: "asset", refId: "nope", x: 0, y: 0 }] };
    const moved = (await app.inject({ method: "PATCH", url: `/api/canvases/${canvas.id}`, payload: { board, title: "Renamed" }, headers: { cookie } })).json();
    expect(moved.title).toBe("Renamed");
    expect(moved.board.viewport.zoom).toBe(0.5);
    expect(moved.board.cards).toEqual([{ ...real, x: 900, y: 450 }]);

    const stranger = await getCanvas(app, canvas.id);
    expect(stranger.isOwner).toBe(false);
    expect((await app.inject({ method: "PATCH", url: `/api/canvases/${canvas.id}`, payload: { title: "Mine now" } })).statusCode).toBe(403);
    expect((await upload(app, canvas.id, "tz_session=forged", "image")).statusCode).toBe(403);

    const removed = (await app.inject({ method: "DELETE", url: `/api/canvases/${canvas.id}/assets/${real.refId}`, headers: { cookie } })).json();
    expect(removed.assets).toHaveLength(0);
    expect(removed.board.cards).toHaveLength(0);
    await app.close();
  });

  it("refuses videos without a character, with too many photos, or with cards from another canvas", async () => {
    const { app } = await testApp({ LIMIT_PER_SESSION_PER_HOUR: "20" }, new FakeProvider(10));
    const { canvas, cookie } = await newCanvas(app);
    const a = (await upload(app, canvas.id, cookie, "character", 4)).json().assets[0];
    const b = (await upload(app, canvas.id, cookie, "character", 4)).json().assets[1];
    const c = (await upload(app, canvas.id, cookie, "character", 4)).json().assets[2];
    const post = (payload: object) => app.inject({ method: "POST", url: `/api/canvases/${canvas.id}/videos`, payload, headers: { cookie } });
    expect((await post({ prompt: "dance", characters: [] })).statusCode).toBe(400);
    expect((await post({ characters: [a.id] })).statusCode).toBe(400);
    expect((await post({ prompt: "dance", characters: [a.id, b.id, c.id] })).json().error).toMatch(/12 photos/);
    const other = await newCanvas(app);
    const foreign = (await upload(app, other.canvas.id, other.cookie, "character")).json().assets[0];
    expect((await post({ prompt: "dance", characters: [foreign.id] })).statusCode).toBe(409);
    expect((await post({ effect: "vanish", characters: [a.id] })).statusCode).toBe(202);
    await app.close();
  }, 30_000);

  it("stops image generation at the daily cap", async () => {
    const { app } = await testApp({}, new FakeProvider(10));
    const { canvas, cookie } = await newCanvas(app);
    const make = () => app.inject({ method: "POST", url: `/api/canvases/${canvas.id}/assets/generate`, payload: { kind: "image", prompt: "a red door" }, headers: { cookie } });
    const results = await Promise.all(Array.from({ length: 25 }, make));
    expect(results.filter((r) => r.statusCode === 202)).toHaveLength(20);
    expect(results.filter((r) => r.statusCode === 429)).toHaveLength(5);
    await idle(app, canvas.id, cookie);
    await app.close();
  }, 60_000);

  it("takes long, multi-paragraph prompts and keeps their line breaks", async () => {
    const { app } = await testApp({ LIMIT_PER_SESSION_PER_HOUR: "20" }, new FakeProvider(10));
    const { canvas, cookie } = await newCanvas(app);
    const paragraph = "Hard cyan-green neon key light from low front-left, sculpting the collarbones and jaw. ".repeat(4).trim();
    const long = [`Outfit: ${paragraph}`, `Lighting: ${paragraph}`, `Action: ${paragraph}`, `Camera: ${paragraph}`].join("\n\n");
    expect(long.length).toBeGreaterThan(1400);

    const made = await app.inject({ method: "POST", url: `/api/canvases/${canvas.id}/assets/generate`, payload: { kind: "character", prompt: `${long}\n\n\n\n  ` }, headers: { cookie } });
    expect(made.statusCode).toBe(202);
    const row = await db.asset.findFirstOrThrow({ where: { canvasId: canvas.id, kind: "character" } });
    expect(row.prompt).toBe(long);

    const tooLong = await app.inject({ method: "POST", url: `/api/canvases/${canvas.id}/assets/generate`, payload: { kind: "image", prompt: "x".repeat(PROMPT_MAX + 1) }, headers: { cookie } });
    expect(tooLong.statusCode).toBe(400);

    const ready = await idle(app, canvas.id, cookie);
    const character = ready.assets[0];
    const outfit = await app.inject({ method: "POST", url: `/api/canvases/${canvas.id}/assets/${character.id}/sheet`, payload: { outfit: paragraph.repeat(2) }, headers: { cookie } });
    expect(outfit.statusCode).toBe(202);

    const video = await app.inject({ method: "POST", url: `/api/canvases/${canvas.id}/videos`, payload: { prompt: long, characters: [character.id] }, headers: { cookie } });
    expect(video.statusCode).toBe(202);
    await idle(app, canvas.id, cookie);
    const clip = await db.generation.findFirstOrThrow({ where: { canvasId: canvas.id } });
    expect(clip.prompt).toContain("Camera: Hard cyan-green neon");
    await app.close();
  }, 60_000);
});

describe("image workflow", () => {
  it("batches references into Nano Banana", () => {
    const g = imageGraph({ prompt: "x", ratio: "16:9", references: 3 });
    expect(g.batch_3!.inputs.image1).toEqual(["batch_2", 0]);
    expect(g.make!.inputs.images).toEqual(["batch_3", 0]);
    expect(imageGraph({ prompt: "x", ratio: "1:1", references: 0 }).make!.inputs.images).toBeUndefined();
  });
});
