import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FakeProvider } from "../src/services/comfy.js";
import { probe } from "../src/services/media.js";
import { shotPrompts, ShotRequestSchema } from "../src/services/shots.js";
import { exampleWorkflows } from "../src/services/workflows.js";
import { db, multipart, testApp, tinyJpeg, waitFor } from "./helpers.js";

beforeEach(async () => {
  await db.generation.deleteMany();
  await db.sequence.deleteMany();
  await db.audioClip.deleteMany();
});
afterAll(async () => { await db.$disconnect(); });

type App = Awaited<ReturnType<typeof testApp>>["app"];
const cookieOf = (res: { headers: Record<string, unknown> }) => String(res.headers["set-cookie"]).split(";")[0]!;

/** A finished clip owned by a fresh visitor, rendered by the local fake provider. */
async function finishedClip(app: App) {
  const body = multipart({ effect: "vanish" }, [{ name: "character", data: await tinyJpeg(), filename: "a.jpg" }]);
  const res = await app.inject({ method: "POST", url: "/api/generations", ...body });
  const cookie = cookieOf(res);
  const id = res.json().id as string;
  await waitFor(async () => ((await db.generation.findUnique({ where: { id } }))?.status === "succeeded" ? true : undefined), 20_000);
  return { id, cookie };
}

async function addShot(app: App, story: string, cookie: string, fields: Record<string, string>, files: Parameters<typeof multipart>[1] = []) {
  const body = multipart(fields, files);
  return app.inject({ method: "POST", url: `/api/sequences/${story}/shots`, payload: body.payload, headers: { ...body.headers, cookie } });
}

const getStory = async (app: App, id: string, cookie?: string) =>
  (await app.inject({ method: "GET", url: `/api/sequences/${id}`, headers: cookie ? { cookie } : {} })).json();

const settled = (app: App, id: string, cookie: string) =>
  waitFor(async () => {
    const s = await getStory(app, id, cookie);
    return s.shots.every((x: { status: string }) => x.status === "succeeded" || x.status === "failed") ? s : undefined;
  }, 30_000);

describe("stories", () => {
  it("adds shots before and after, mixes sound layers, and exports one video", async () => {
    const { app } = await testApp({ LIMIT_PER_SESSION_PER_HOUR: "20" }, new FakeProvider(10));
    const { id: sourceId, cookie } = await finishedClip(app);
    const created = await app.inject({ method: "POST", url: "/api/sequences", payload: { sourceId }, headers: { cookie } });
    expect(created.statusCode).toBe(201);
    const story = created.json();
    expect(story.isOwner).toBe(true);
    expect(story.shots.map((s: { id: string }) => s.id)).toEqual([sourceId]);

    const after = await addShot(app, story.id, cookie, { anchorId: sourceId, side: "after", mode: "continue", action: "She switches to hip-hop", seconds: "5" });
    expect(after.statusCode).toBe(202);
    const restage = await addShot(app, story.id, cookie, { anchorId: sourceId, side: "before", mode: "restage", place: "a rainy New York street", keepMoves: "true", seconds: "5" },
      [{ name: "character", data: await tinyJpeg(), filename: "friend.jpg" }]);
    expect(restage.statusCode).toBe(202);
    const before = await addShot(app, story.id, cookie, { anchorId: sourceId, side: "before", mode: "continue", place: "her bedroom", seconds: "5" });
    expect(before.statusCode).toBe(202);

    const done = await settled(app, story.id, cookie);
    expect(done.shots.map((s: { mode: string; side: string | null }) => `${s.mode}:${s.side}`)).toEqual(["restage:before", "continue:before", "original:null", "continue:after"]);
    expect(done.shots.every((s: { status: string }) => s.status === "succeeded")).toBe(true);

    const rows = await db.generation.findMany({ where: { sequenceId: story.id } });
    const byMode = (m: string, side: string) => rows.find((r) => r.shotMode === m && (r.references as { side: string }).side === side)!;
    expect(byMode("continue", "after").prompt).toContain("Continue seamlessly from the first frame");
    expect(byMode("restage", "before").prompt).toContain("Perform exactly the same moves as in Video 1");
    expect(byMode("restage", "before").prompt).toContain("Image 1 and Image 2 show the people");
    expect((byMode("continue", "before").references as { scenePrompt: string }).scenePrompt).toContain("her bedroom");

    // Sound: an AI sound effect, and the original clip's own sound, playing together.
    const sfx = await app.inject({ method: "POST", url: "/api/audio", payload: { kind: "sfx", prompt: "steady rain", seconds: 4 }, headers: { cookie } });
    expect(sfx.statusCode).toBe(202);
    const original = await app.inject({ method: "POST", url: "/api/audio/original", payload: { shotId: sourceId }, headers: { cookie } });
    expect(original.statusCode).toBe(201);
    await waitFor(async () => ((await db.audioClip.findUnique({ where: { id: sfx.json().id } }))?.status === "succeeded" ? true : undefined), 20_000);
    // The same clip's sound asked for twice is one copy.
    const again = await app.inject({ method: "POST", url: "/api/audio/original", payload: { shotId: sourceId }, headers: { cookie } });
    expect(again.json().id).toBe(original.json().id);
    // Looping, a layer past the end, and several shots together used to hang ffmpeg.
    const layers = [
      { id: "a", source: { clipId: original.json().id }, label: "Original", start: 10, length: null, volume: 1, loop: false },
      { id: "b", source: { clipId: sfx.json().id }, label: "Rain", start: 0, length: null, volume: 0.6, loop: true },
      { id: "c", source: { clipId: sfx.json().id }, label: "Late", start: 500, length: null, volume: 1, loop: true },
    ];
    const put = await app.inject({ method: "PUT", url: `/api/sequences/${story.id}/audio`, payload: { layers }, headers: { cookie } });
    expect(put.statusCode).toBe(200);
    expect(Object.values(put.json().clips).every((c) => (c as { status: string }).status === "succeeded")).toBe(true);

    const exp = await app.inject({ method: "POST", url: `/api/sequences/${story.id}/export`, headers: { cookie } });
    expect(exp.statusCode).toBe(202);
    const ready = await waitFor(async () => {
      const s = await getStory(app, story.id, cookie);
      return s.export.status === "ready" || s.export.status === "failed" ? s : undefined;
    }, 30_000);
    expect(ready.export.status).toBe("ready");
    expect(ready.export.stale).toBe(false);
    const { dataDir } = { dataDir: app.storage.absolutePath("") };
    const info = await probe(`${dataDir}${ready.export.url}`);
    expect(info.hasAudio).toBe(true);
    expect(info.seconds).toBeGreaterThan(ready.totalSeconds - 0.5);
    expect(info.seconds).toBeLessThan(ready.totalSeconds + 0.5);

    // Adding a shot before the original clip moves the clip's own sound with it; the rain stays put.
    const moved = await addShot(app, story.id, cookie, { anchorId: done.shots[0].id, side: "before", mode: "continue", seconds: "6" });
    const shifted = moved.json().audio as { id: string; start: number }[];
    expect(shifted.find((l) => l.id === "a")!.start).toBe(16);
    expect(shifted.find((l) => l.id === "b")!.start).toBe(0);
    await settled(app, story.id, cookie);

    // Any edit makes the export out of date.
    const edited = await app.inject({ method: "PUT", url: `/api/sequences/${story.id}/audio`, payload: { layers: shifted.slice(1, 2) }, headers: { cookie } });
    expect(edited.json().export.stale).toBe(true);
    await app.close();
  }, 120_000);

  it("only lets the owner edit, and keeps the rules for each shot type", async () => {
    const { app } = await testApp({ LIMIT_PER_SESSION_PER_HOUR: "20" }, new FakeProvider(10));
    const { id: sourceId, cookie } = await finishedClip(app);
    const story = (await app.inject({ method: "POST", url: "/api/sequences", payload: { sourceId }, headers: { cookie } })).json();

    const stranger = await getStory(app, story.id);
    expect(stranger.isOwner).toBe(false);
    expect((await addShot(app, story.id, "tz_session=forged", { anchorId: sourceId, side: "after", mode: "continue" })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/sequences", payload: { sourceId } })).statusCode).toBe(404);

    const withPhoto = await addShot(app, story.id, cookie, { anchorId: sourceId, side: "after", mode: "continue" }, [{ name: "character", data: await tinyJpeg(), filename: "x.jpg" }]);
    expect(withPhoto.statusCode).toBe(400);
    expect((await addShot(app, story.id, cookie, { anchorId: "nope", side: "after", mode: "continue" })).statusCode).toBe(400);
    expect((await addShot(app, story.id, cookie, { anchorId: sourceId, side: "after", mode: "continue", seconds: "7" })).statusCode).toBe(400);

    expect((await app.inject({ method: "DELETE", url: `/api/sequences/${story.id}/shots/${sourceId}`, headers: { cookie } })).statusCode).toBe(400);
    const added = (await addShot(app, story.id, cookie, { anchorId: sourceId, side: "after", mode: "continue" })).json();
    const shotId = added.shots[1].id;
    await settled(app, story.id, cookie);
    const removed = await app.inject({ method: "DELETE", url: `/api/sequences/${story.id}/shots/${shotId}`, headers: { cookie } });
    expect(removed.json().shots).toHaveLength(1);

    // Layers can't point at someone else's sound or at a library sound that doesn't exist.
    const other = await finishedClip(app);
    const theirs = (await app.inject({ method: "POST", url: "/api/audio/original", payload: { shotId: other.id }, headers: { cookie: other.cookie } })).json();
    const bad = [{ id: "x", source: { clipId: theirs.id }, label: "Theirs", start: 0, length: null, volume: 1, loop: false }];
    expect((await app.inject({ method: "PUT", url: `/api/sequences/${story.id}/audio`, payload: { layers: bad }, headers: { cookie } })).statusCode).toBe(400);
    const missing = [{ id: "y", source: { sound: "no-such-sound" }, label: "Ghost", start: 0, length: null, volume: 1, loop: false }];
    expect((await app.inject({ method: "PUT", url: `/api/sequences/${story.id}/audio`, payload: { layers: missing }, headers: { cookie } })).statusCode).toBe(400);
    await app.close();
  }, 120_000);

  it("counts shots against the same spending caps as any clip", async () => {
    const { app } = await testApp({ LIMIT_PER_SESSION_PER_HOUR: "1" }, new FakeProvider(10));
    const { id: sourceId, cookie } = await finishedClip(app);
    const story = (await app.inject({ method: "POST", url: "/api/sequences", payload: { sourceId }, headers: { cookie } })).json();
    const res = await addShot(app, story.id, cookie, { anchorId: sourceId, side: "after", mode: "continue" });
    expect(res.statusCode).toBe(429);
    expect((await getStory(app, story.id, cookie)).shots).toHaveLength(1);
    await app.close();
  }, 60_000);
});

describe("story prompts and workflows", () => {
  const req = (fields: Record<string, string>) => ShotRequestSchema.parse({ anchorId: "x", ...fields });
  it("writes a start frame prompt only for shots before a clip", () => {
    expect(shotPrompts(req({ side: "after", mode: "continue" }), ["first_frame"]).scenePrompt).toBeUndefined();
    const before = shotPrompts(req({ side: "before", mode: "continue", place: "a stage", style: "Y2K" }), ["last_frame"]);
    expect(before.prompt).toContain("ends exactly on the last frame");
    expect(before.scenePrompt).toContain("a stage, in the style of Y2K");
  });
  it("lets Restage drop the moves when asked", () => {
    const loose = shotPrompts(req({ side: "after", mode: "restage", keepMoves: "false" }), ["character", "video"]).prompt;
    expect(loose).not.toContain("exactly the same moves");
  });
  it("keeps the workflow files in workflows/ up to date", () => {
    for (const [name, graph] of Object.entries(exampleWorkflows())) {
      const file = readFileSync(new URL(`../../../workflows/${name}`, import.meta.url), "utf8");
      expect(file, `${name} is stale: run npm run export-workflows`).toBe(`${JSON.stringify(graph, null, 2)}\n`);
    }
  });
});
