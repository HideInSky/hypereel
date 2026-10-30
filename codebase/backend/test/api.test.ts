import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, multipart, stubProvider, testApp, tinyJpeg, waitFor } from "./helpers.js";

beforeEach(async () => { await db.generation.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });

describe("POST /api/generations", () => {
  it("creates a generation, runs it, and exposes a share page with OG tags", async () => {
    const { app } = await testApp();
    const body = multipart({ genre: "trailer", caption: "my cat Mochi" }, { name: "image", data: await tinyJpeg(), filename: "cat.jpg" });
    const res = await app.inject({ method: "POST", url: "/api/generations", ...body });
    expect(res.statusCode).toBe(202);
    const created = res.json();
    expect(created.status).toBe("queued");
    expect(res.headers["set-cookie"]).toMatch(/tz_session/);

    const done = await waitFor(async () => {
      const r = await app.inject({ method: "GET", url: `/api/generations/${created.id}` });
      const j = r.json();
      return j.status === "succeeded" ? j : undefined;
    });
    expect(done.videoUrl).toMatch(/^\/media\/.*\.mp4$/);
    expect(done.shareUrl).toBe(`http://test.local/v/${created.id}`);
    expect(done.script).toBe("A test scene.");

    const media = await app.inject({ method: "GET", url: done.videoUrl });
    expect(media.statusCode).toBe(200);
    expect(media.body).toBe("not-really-mp4");

    const share = await app.inject({ method: "GET", url: `/v/${created.id}` });
    expect(share.statusCode).toBe(200);
    expect(share.body).toContain('property="og:video"');
    expect(share.body).toContain("my cat Mochi");

    const feed = await app.inject({ method: "GET", url: "/api/feed" });
    expect(feed.json()).toHaveLength(1);
    await app.close();
  });

  it("marks failed provider runs as failed with a message", async () => {
    const { app } = await testApp({}, stubProvider({ fail: true }));
    const body = multipart({ genre: "horror" }, { name: "image", data: await tinyJpeg(), filename: "x.jpg" });
    const res = await app.inject({ method: "POST", url: "/api/generations", ...body });
    const { id } = res.json();
    const failed = await waitFor(async () => {
      const j = (await app.inject({ method: "GET", url: `/api/generations/${id}` })).json();
      return j.status === "failed" ? j : undefined;
    });
    expect(failed.error).toBe("boom");
    await app.close();
  });

  it("rejects missing image, bad genre, and unreadable images", async () => {
    const { app } = await testApp();
    const noImage = await app.inject({ method: "POST", url: "/api/generations", ...multipart({ genre: "trailer" }) });
    expect(noImage.statusCode).toBe(400);
    const badGenre = await app.inject({ method: "POST", url: "/api/generations", ...multipart({ genre: "western" }, { name: "image", data: await tinyJpeg(), filename: "a.jpg" }) });
    expect(badGenre.statusCode).toBe(400);
    const garbage = await app.inject({ method: "POST", url: "/api/generations", ...multipart({ genre: "trailer" }, { name: "image", data: Buffer.from("hello"), filename: "a.jpg" }) });
    expect(garbage.statusCode).toBe(400);
    await app.close();
  });

  it("enforces the per-session hourly limit", async () => {
    const { app } = await testApp({ LIMIT_PER_SESSION_PER_HOUR: "1" });
    const img = await tinyJpeg();
    const first = await app.inject({ method: "POST", url: "/api/generations", ...multipart({ genre: "trailer" }, { name: "image", data: img, filename: "a.jpg" }) });
    expect(first.statusCode).toBe(202);
    const cookie = String(first.headers["set-cookie"]).split(";")[0];
    const b = multipart({ genre: "trailer" }, { name: "image", data: img, filename: "a.jpg" });
    const second = await app.inject({ method: "POST", url: "/api/generations", payload: b.payload, headers: { ...b.headers, cookie } });
    expect(second.statusCode).toBe(429);
    expect(second.json().reason).toBe("session");
    await app.close();
  });

  it("enforces the global daily cap", async () => {
    const { app } = await testApp({ LIMIT_GLOBAL_PER_DAY: "0" });
    const res = await app.inject({ method: "POST", url: "/api/generations", ...multipart({ genre: "trailer" }, { name: "image", data: await tinyJpeg(), filename: "a.jpg" }) });
    expect(res.statusCode).toBe(429);
    expect(res.json().reason).toBe("global");
    await app.close();
  });
});
