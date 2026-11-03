import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FakeProvider, type GraphJob } from "../src/services/comfy.js";
import { sheetPrompt } from "../src/services/workflows.js";
import { db, multipart, testApp, tinyJpeg, waitFor } from "./helpers.js";

beforeEach(async () => {
  await db.generation.deleteMany();
  await db.sequence.deleteMany();
  await db.asset.deleteMany();
  await db.assetCategory.deleteMany();
  await db.canvas.deleteMany();
});
afterAll(async () => { await db.$disconnect(); });

/** Fake renders, plus a record of every graph prompt sent. */
class RecordingProvider extends FakeProvider {
  prompts: string[] = [];
  override async runGraph(job: GraphJob) {
    const make = Object.values(job.graph).find((n) => n.class_type === "GeminiNanoBanana2");
    if (make) this.prompts.push(String(make.inputs.prompt));
    return super.runGraph(job);
  }
}

type App = Awaited<ReturnType<typeof testApp>>["app"];
const cookieOf = (res: { headers: Record<string, unknown> }) => String(res.headers["set-cookie"]).split(";")[0]!;

async function setup() {
  const provider = new RecordingProvider(10);
  const { app, dataDir } = await testApp({}, provider);
  const res = await app.inject({ method: "POST", url: "/api/canvases", payload: { title: "Board" } });
  return { app, dataDir, provider, canvasId: res.json().id as string, cookie: cookieOf(res) };
}

async function uploadTo(app: App, url: string, cookie: string, fields: Record<string, string>) {
  const body = multipart(fields, [{ name: "photo", data: await tinyJpeg(), filename: "p.jpg" }]);
  return app.inject({ method: "POST", url, payload: body.payload, headers: { ...body.headers, cookie } });
}

const library = async (app: App, cookie: string) => (await app.inject({ method: "GET", url: "/api/library", headers: { cookie } })).json();
const settled = (app: App, cookie: string) =>
  waitFor(async () => {
    const lib = await library(app, cookie);
    return lib.items.some((i: { status: string }) => i.status === "queued" || i.status === "running") ? undefined : lib;
  }, 20_000);

describe("assets library", () => {
  it("saves a canvas card as its own copy, once, and brings it back onto a canvas", async () => {
    const { app, dataDir, canvasId, cookie } = await setup();
    const canvas = (await uploadTo(app, `/api/canvases/${canvasId}/assets`, cookie, { kind: "character", name: "Mia" })).json();
    const card = canvas.assets[0];

    const save = await app.inject({ method: "POST", url: "/api/library/save", headers: { cookie }, payload: { from: "asset", canvasId, assetId: card.id } });
    expect(save.statusCode).toBe(201);
    const item = save.json();
    expect(item).toMatchObject({ kind: "character", name: "Mia", category: "characters", favorite: false, canRegenerate: false });
    expect(item.images[0]).not.toBe(card.images[0]);
    const again = await app.inject({ method: "POST", url: "/api/library/save", headers: { cookie }, payload: { from: "asset", canvasId, assetId: card.id } });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(item.id);
    expect((await app.inject({ method: "GET", url: `/api/canvases/${canvasId}`, headers: { cookie } })).json().assets[0].savedId).toBe(item.id);

    // Deleting the card leaves the library copy's file alone.
    await app.inject({ method: "DELETE", url: `/api/canvases/${canvasId}/assets/${card.id}`, headers: { cookie } });
    expect(existsSync(path.join(dataDir, item.images[0]))).toBe(true);

    const imported = await app.inject({ method: "POST", url: `/api/canvases/${canvasId}/assets/import`, headers: { cookie }, payload: { ids: [item.id] } });
    expect(imported.statusCode).toBe(201);
    const board = imported.json();
    expect(board.assets).toHaveLength(1);
    expect(board.assets[0].savedId).toBe(item.id);
    expect(board.board.cards).toHaveLength(1);
    expect((await library(app, cookie)).items[0].usedAt).not.toBeNull();
  });

  it("saves a finished clip as a video item", async () => {
    const { app, dataDir, canvasId, cookie } = await setup();
    const { sessionId } = await db.canvas.findUniqueOrThrow({ where: { id: canvasId } });
    await fs.mkdir(path.join(dataDir, "media"), { recursive: true });
    await fs.writeFile(path.join(dataDir, "media/clip.mp4"), "mp4");
    await fs.writeFile(path.join(dataDir, "media/clip.jpg"), "jpg");
    const clip = await db.generation.create({ data: { status: "succeeded", genre: "melting", prompt: "p", model: "m", inputPath: "x", videoPath: "media/clip.mp4", posterPath: "media/clip.jpg", sessionId, ip: "1.1.1.1" } });

    const res = await app.inject({ method: "POST", url: "/api/library/save", headers: { cookie }, payload: { from: "video", generationId: clip.id, category: "places" } });
    expect(res.statusCode).toBe(201);
    const item = res.json();
    expect(item.kind).toBe("video");
    expect(item.videoUrl).toMatch(/\.mp4$/);
    expect(item.videoUrl).not.toBe("/media/clip.mp4");
    expect(item.images).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: `/api/generations/${clip.id}`, headers: { cookie } })).json().savedId).toBe(item.id);

    // A video can't go on a canvas or be a reference.
    expect((await app.inject({ method: "POST", url: `/api/canvases/${canvasId}/assets/import`, headers: { cookie }, payload: { ids: [item.id] } })).statusCode).toBe(400);
    // Someone else's clip can't be saved.
    const other = await app.inject({ method: "POST", url: "/api/canvases", payload: {} });
    expect((await app.inject({ method: "POST", url: "/api/library/save", headers: { cookie: cookieOf(other) }, payload: { from: "video", generationId: clip.id } })).statusCode).toBe(404);
  });

  it("organizes items: categories, favorites, names and a custom order, private to their owner", async () => {
    const { app, cookie } = await setup();
    const cat = await app.inject({ method: "POST", url: "/api/library/categories", headers: { cookie }, payload: { name: "Costumes" } });
    expect(cat.statusCode).toBe(201);
    const costumes = cat.json().id;
    expect((await app.inject({ method: "POST", url: "/api/library/categories", headers: { cookie }, payload: { name: "places" } })).statusCode).toBe(409);
    expect((await uploadTo(app, "/api/library/upload", cookie, { kind: "image", name: "Bad", category: "nope" })).statusCode).toBe(400);

    const a = (await uploadTo(app, "/api/library/upload", cookie, { kind: "image", name: "Coat", category: costumes })).json();
    const b = (await uploadTo(app, "/api/library/upload", cookie, { kind: "image", name: "Street", category: "places" })).json();
    expect(a.category).toBe(costumes);

    const patched = await app.inject({ method: "PATCH", url: `/api/library/${b.id}`, headers: { cookie }, payload: { name: "Night street", favorite: true, category: "props" } });
    expect(patched.json()).toMatchObject({ name: "Night street", favorite: true, category: "props" });

    expect((await app.inject({ method: "PUT", url: "/api/library/order", headers: { cookie }, payload: { ids: [b.id, a.id] } })).statusCode).toBe(204);
    const lib = await library(app, cookie);
    const pos = Object.fromEntries(lib.items.map((i: { id: string; position: number }) => [i.id, i.position]));
    expect(pos[b.id]).toBeLessThan(pos[a.id]);
    expect(lib.categories.map((c: { name: string }) => c.name)).toEqual(["Characters", "Places", "Props", "Costumes"]);

    expect((await app.inject({ method: "DELETE", url: `/api/library/categories/places`, headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/library/categories/${costumes}`, headers: { cookie } })).statusCode).toBe(204);
    expect((await library(app, cookie)).items.find((i: { id: string }) => i.id === a.id).category).toBeNull();

    // Another visitor sees none of it and can't change it.
    const stranger = cookieOf(await app.inject({ method: "POST", url: "/api/canvases", payload: {} }));
    expect((await library(app, stranger)).items).toHaveLength(0);
    expect((await app.inject({ method: "PATCH", url: `/api/library/${a.id}`, headers: { cookie: stranger }, payload: { favorite: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/library/${a.id}`, headers: { cookie: stranger } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: "/api/library/order", headers: { cookie: stranger }, payload: { ids: [a.id, b.id] } })).statusCode).toBe(204);
    expect((await db.asset.findUniqueOrThrow({ where: { id: a.id } })).position).toBe(2);

    expect((await app.inject({ method: "DELETE", url: `/api/library/${a.id}`, headers: { cookie } })).statusCode).toBe(204);
    expect((await library(app, cookie)).items).toHaveLength(1);
  });

  it("makes character sheets, outfit and style variants, and regenerates", async () => {
    const { app, cookie, provider } = await setup();
    const made = await app.inject({ method: "POST", url: "/api/library/generate", headers: { cookie }, payload: { kind: "character", name: "Elias", prompt: "a late-20s expedition cartographer with a short beard" } });
    expect(made.statusCode).toBe(202);
    const elias = made.json();
    expect(elias.canRegenerate).toBe(true);
    await settled(app, cookie);

    const sheet = (await app.inject({ method: "POST", url: `/api/library/${elias.id}/sheet`, headers: { cookie }, payload: {} })).json();
    expect(sheet).toMatchObject({ kind: "sheet", name: "Elias sheet", category: "characters", sources: [elias.id], prompt: null });
    await settled(app, cookie);
    const sheetPromptSent = provider.prompts.at(-1)!;
    expect(sheetPromptSent).toContain("three equal vertical panels");
    expect(sheetPromptSent).toContain("expedition cartographer");
    expect(sheetPromptSent).toContain("mid-grey");

    expect((await app.inject({ method: "POST", url: `/api/library/${sheet.id}/sheet`, headers: { cookie }, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/library/${sheet.id}/sheet`, headers: { cookie }, payload: { outfit: "a", style: "b" } })).statusCode).toBe(400);
    const winter = (await app.inject({ method: "POST", url: `/api/library/${sheet.id}/sheet`, headers: { cookie }, payload: { outfit: "a wax jacket and a beanie" } })).json();
    expect(winter).toMatchObject({ name: "Elias sheet (a wax jacket and a beanie)", prompt: "New outfit: a wax jacket and a beanie", sources: [sheet.id] });
    await settled(app, cookie);
    expect(provider.prompts.at(-1)).toContain("new outfit: a wax jacket and a beanie");

    const again = await app.inject({ method: "POST", url: `/api/library/${winter.id}/regenerate`, headers: { cookie } });
    expect(again.statusCode).toBe(202);
    expect(again.json()).toMatchObject({ kind: "sheet", prompt: "New outfit: a wax jacket and a beanie", sources: [sheet.id] });
    const lib = await settled(app, cookie);
    expect(lib.items.every((i: { status: string }) => i.status === "succeeded")).toBe(true);
    expect(lib.items).toHaveLength(4);

    const upload = (await uploadTo(app, "/api/library/upload", cookie, { kind: "image", name: "Mine" })).json();
    expect((await app.inject({ method: "POST", url: `/api/library/${upload.id}/regenerate`, headers: { cookie } })).statusCode).toBe(400);
  });

  it("makes a new art style from a sheet on a canvas", async () => {
    const { app, canvasId, cookie, provider } = await setup();
    const canvas = (await uploadTo(app, `/api/canvases/${canvasId}/assets`, cookie, { kind: "character", name: "Mia" })).json();
    await app.inject({ method: "POST", url: `/api/canvases/${canvasId}/assets/${canvas.assets[0].id}/sheet`, headers: { cookie } });
    const sheet = await waitFor(async () => {
      const c = (await app.inject({ method: "GET", url: `/api/canvases/${canvasId}`, headers: { cookie } })).json();
      return c.assets.find((a: { kind: string; status: string }) => a.kind === "sheet" && a.status === "succeeded");
    }, 20_000);
    const styled = await app.inject({ method: "POST", url: `/api/canvases/${canvasId}/assets/${sheet.id}/sheet`, headers: { cookie }, payload: { style: "claymation" } });
    expect(styled.statusCode).toBe(202);
    expect(styled.json().assets.find((a: { name: string }) => a.name === "Mia sheet (claymation)")).toBeTruthy();
    await waitFor(async () => (provider.prompts.length >= 2 ? true : undefined), 20_000);
    expect(provider.prompts.at(-1)).toContain("art style: claymation");
    expect(provider.prompts.at(-1)).not.toContain("Photorealistic");
  });

  it("writes one sheet layout for photos and for invented characters", () => {
    expect(sheetPrompt()).toContain("the person in the reference images.");
    expect(sheetPrompt({ identity: "a tall woman." })).toContain("(a tall woman)");
    expect(sheetPrompt()).toContain("cropped at the neck");
  });
});
