import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { resumeInterrupted } from "../src/services/generator.js";
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
    const row = await db.generation.findUniqueOrThrow({ where: { id: created.id } });
    expect((row.references as { role: string }[]).map((r) => r.role)).toEqual(["character", "character", "location", "product"]);
    expect(row.comfyJobId).toBe("job-1");
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

  it("holds the global cap under parallel requests", async () => {
    const { app } = await testApp({ LIMIT_GLOBAL_PER_DAY: "2", LIMIT_PER_IP_PER_DAY: "99", LIMIT_PER_SESSION_PER_HOUR: "99" });
    const img = await tinyJpeg();
    const res = await Promise.all(Array.from({ length: 10 }, () =>
      app.inject({ method: "POST", url: "/api/generations", ...multipart({ effect: "vanish" }, [{ name: "character", data: img, filename: "a.jpg" }]) }),
    ));
    expect(res.filter((r) => r.statusCode === 202)).toHaveLength(2);
    expect(res.filter((r) => r.statusCode === 429)).toHaveLength(8);
    await app.close();
  });

  it("ignores a spoofed X-Forwarded-For", async () => {
    const { app } = await testApp({ LIMIT_PER_IP_PER_DAY: "1", LIMIT_PER_SESSION_PER_HOUR: "99" });
    const img = await tinyJpeg();
    const send = (ip: string) => {
      const b = multipart({ effect: "vanish" }, [{ name: "character", data: img, filename: "a.jpg" }]);
      return app.inject({ method: "POST", url: "/api/generations", payload: b.payload, headers: { ...b.headers, "x-forwarded-for": ip } });
    };
    expect((await send("1.1.1.1")).statusCode).toBe(202);
    expect((await send("2.2.2.2")).statusCode).toBe(429);
    await app.close();
  });

  it("reads the client IP from the configured proxy header", async () => {
    const { app } = await testApp({ LIMIT_PER_IP_PER_DAY: "1", LIMIT_PER_SESSION_PER_HOUR: "99", CLIENT_IP_HEADER: "x-real-ip" });
    const img = await tinyJpeg();
    const send = (ip: string) => {
      const b = multipart({ effect: "vanish" }, [{ name: "character", data: img, filename: "a.jpg" }]);
      return app.inject({ method: "POST", url: "/api/generations", payload: b.payload, headers: { ...b.headers, "x-real-ip": ip } });
    };
    expect((await send("1.1.1.1")).statusCode).toBe(202);
    expect((await send("1.1.1.1")).statusCode).toBe(429);
    expect((await send("2.2.2.2")).statusCode).toBe(202);
    await app.close();
  });

  it("shows uploaded photos and notes only to the clip's owner", async () => {
    const { app } = await testApp();
    const res = await app.inject({ method: "POST", url: "/api/generations", ...multipart({ effect: "vanish", prompt: "secret note" }, [{ name: "character", data: await tinyJpeg(), filename: "a.jpg" }]) });
    const created = res.json();
    expect(created.posterUrl).toMatch(/^\/media\//);
    const cookie = String(res.headers["set-cookie"]).split(";")[0]!;

    const stranger = await waitFor(async () => {
      const j = (await app.inject({ method: "GET", url: `/api/generations/${created.id}` })).json();
      return j.status === "succeeded" ? j : undefined;
    });
    expect(stranger.posterUrl).toBeNull();
    expect(stranger.prompt).toBeNull();
    expect(stranger.references).toBeUndefined();
    expect(stranger.videoUrl).toBeTruthy();

    const owner = (await app.inject({ method: "GET", url: `/api/generations/${created.id}`, headers: { cookie } })).json();
    expect(owner.posterUrl).toBe(created.posterUrl);
    expect(owner.prompt).toBe("secret note");

    const share = await app.inject({ method: "GET", url: `/v/${created.id}` });
    expect(share.body).not.toContain(created.posterUrl);
    expect(share.body).toContain("/og.png");
    await app.close();
  });

  it("recovers renders interrupted by a restart", async () => {
    const { app, cfg } = await testApp();
    const base = { genre: "vanish", prompt: "p", model: "m", inputPath: "media/x.jpg", sessionId: "s", ip: "i", status: "running" as const };
    const paid = await db.generation.create({ data: { ...base, comfyJobId: "job-9" } });
    const unsent = await db.generation.create({ data: base });
    const quiet = { info: () => {}, error: () => {} };
    const { finished } = await resumeInterrupted({ db, provider: stubProvider(), storage: app.storage, cfg, log: quiet });
    await finished;

    const recovered = await db.generation.findUniqueOrThrow({ where: { id: paid.id } });
    expect(recovered.status).toBe("succeeded");
    expect(recovered.videoPath).toBeTruthy();
    const lost = await db.generation.findUniqueOrThrow({ where: { id: unsent.id } });
    expect(lost.status).toBe("failed");
    await app.close();
  });
});

describe("production config", () => {
  const prod = { NODE_ENV: "production", DATABASE_URL: "postgresql://x", COMFY_MODE: "fake" } as NodeJS.ProcessEnv;
  it("refuses to start with the default cookie secret", () => {
    expect(() => loadConfig(prod)).toThrow(/COOKIE_SECRET/);
    expect(loadConfig({ ...prod, COOKIE_SECRET: "a-long-enough-real-secret" }).NODE_ENV).toBe("production");
  });
  it("uses x-real-ip on Railway unless told otherwise", () => {
    const env = { ...prod, COOKIE_SECRET: "a-long-enough-real-secret", RAILWAY_PROJECT_ID: "p" };
    expect(loadConfig(env).CLIENT_IP_HEADER).toBe("x-real-ip");
    expect(loadConfig({ ...env, CLIENT_IP_HEADER: "cf-connecting-ip" }).CLIENT_IP_HEADER).toBe("cf-connecting-ip");
  });
});
