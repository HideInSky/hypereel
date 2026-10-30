import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, multipart, stubProvider, testApp, tinyJpeg, waitFor } from "./helpers.js";

beforeEach(async () => { await db.generation.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });

describe("POST /api/generations", () => {
  it("creates a generation, runs it, and exposes a share page with OG tags", async () => {
    const { app } = await testApp();
    const img = await tinyJpeg();
    const body = multipart({ effect: "vanish", prompt: "red coat", aspectRatio: "1:1" }, [
      { name: "product", data: img, filename: "p.jpg" },
      { name: "character", data: img, filename: "c1.jpg" },
      { name: "character", data: img, filename: "c2.jpg" },
      { name: "location", data: img, filename: "l.jpg" },
    ]);
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
    expect(done.references.map((r: { role: string }) => r.role)).toEqual(["character", "character", "location", "product"]);
    expect(done.aspectRatio).toBe("1:1");
    expect(done.effectLabel).toBe("Vanish");

    const media = await app.inject({ method: "GET", url: done.videoUrl });
    expect(media.statusCode).toBe(200);
    expect(media.body).toBe("not-really-mp4");

    const share = await app.inject({ method: "GET", url: `/v/${created.id}` });
    expect(share.statusCode).toBe(200);
    expect(share.body).toContain('property="og:video"');
    expect(share.body).toContain("Vanish");

    const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
    const mine = await app.inject({ method: "GET", url: "/api/history", headers: { cookie } });
    expect(mine.json()).toHaveLength(1);
    const others = await app.inject({ method: "GET", url: "/api/history" });
    expect(others.json()).toHaveLength(0);
    await app.close();
  });

  it("marks failed provider runs as failed with a message", async () => {
    const { app } = await testApp({}, stubProvider({ fail: true }));
    const body = multipart({ effect: "eyes-in" }, [{ name: "character", data: await tinyJpeg(), filename: "x.jpg" }]);
    const res = await app.inject({ method: "POST", url: "/api/generations", ...body });
    const { id } = res.json();
    const failed = await waitFor(async () => {
      const j = (await app.inject({ method: "GET", url: `/api/generations/${id}` })).json();
      return j.status === "failed" ? j : undefined;
    });
    expect(failed.error).toBe("boom");
    await app.close();
  });

  it("rejects no character, bad effect, too many photos, and unreadable images", async () => {
    const { app } = await testApp();
    const noImage = await app.inject({ method: "POST", url: "/api/generations", ...multipart({ effect: "vanish" }, [{ name: "location", data: await tinyJpeg(), filename: "l.jpg" }]) });
    expect(noImage.statusCode).toBe(400);
    const badEffect = await app.inject({ method: "POST", url: "/api/generations", ...multipart({ effect: "western" }, [{ name: "character", data: await tinyJpeg(), filename: "a.jpg" }]) });
    expect(badEffect.statusCode).toBe(400);
    const tiny = await tinyJpeg();
    const tooMany = await app.inject({ method: "POST", url: "/api/generations", ...multipart({ effect: "vanish" }, Array.from({ length: 5 }, (_, i) => ({ name: "character", data: tiny, filename: `${i}.jpg` }))) });
    expect(tooMany.statusCode).toBe(400);
    const garbage = await app.inject({ method: "POST", url: "/api/generations", ...multipart({ effect: "vanish" }, [{ name: "character", data: Buffer.from("hello"), filename: "a.jpg" }]) });
    expect(garbage.statusCode).toBe(400);
    await app.close();
  });

  it("enforces the per-session hourly limit", async () => {
    const { app } = await testApp({ LIMIT_PER_SESSION_PER_HOUR: "1" });
    const img = await tinyJpeg();
    const first = await app.inject({ method: "POST", url: "/api/generations", ...multipart({ effect: "vanish" }, [{ name: "character", data: img, filename: "a.jpg" }]) });
    expect(first.statusCode).toBe(202);
    const cookie = String(first.headers["set-cookie"]).split(";")[0];
    const b = multipart({ effect: "vanish" }, [{ name: "character", data: img, filename: "a.jpg" }]);
    const second = await app.inject({ method: "POST", url: "/api/generations", payload: b.payload, headers: { ...b.headers, cookie } });
    expect(second.statusCode).toBe(429);
    expect(second.json().reason).toBe("session");
    await app.close();
  });

  it("enforces the global daily cap", async () => {
    const { app } = await testApp({ LIMIT_GLOBAL_PER_DAY: "0" });
    const res = await app.inject({ method: "POST", url: "/api/generations", ...multipart({ effect: "vanish" }, [{ name: "character", data: await tinyJpeg(), filename: "a.jpg" }]) });
    expect(res.statusCode).toBe(429);
    expect(res.json().reason).toBe("global");
    await app.close();
  });
});
