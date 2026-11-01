import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { resumeInterrupted } from "../src/services/generator.js";
import { db, multipart, stubProvider, testApp, tinyJpeg, waitFor } from "./helpers.js";

beforeEach(async () => { await db.generation.deleteMany(); await db.customEffect.deleteMany(); });
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
    const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
    const failed = await waitFor(async () => {
      const j = (await app.inject({ method: "GET", url: `/api/generations/${id}`, headers: { cookie } })).json();
      return j.status === "failed" ? j : undefined;
    });
    expect(failed.error).toBe("boom");
    const stranger = (await app.inject({ method: "GET", url: `/api/generations/${id}` })).json();
    expect(stranger.status).toBe("failed");
    expect(stranger.error).toBeNull();
    await app.close();
  });

  it("never stores the API key in an error message", async () => {
    const { app } = await testApp({ COMFY_API_KEY: "boom" }, stubProvider({ fail: true }));
    const body = multipart({ effect: "vanish" }, [{ name: "character", data: await tinyJpeg(), filename: "x.jpg" }]);
    const { id } = (await app.inject({ method: "POST", url: "/api/generations", ...body })).json();
    const row = await waitFor(async () => {
      const r = await db.generation.findUnique({ where: { id } });
      return r?.status === "failed" ? r : undefined;
    });
    expect(row.error).toBe("[redacted]");
    await app.close();
  });

  it("doesn't grant other websites access to the API", async () => {
    const { app } = await testApp();
    const res = await app.inject({ method: "GET", url: "/api/effects", headers: { origin: "https://evil.example" } });
    expect(res.headers["access-control-allow-origin"]).not.toBe("https://evil.example");
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

describe("custom effects", () => {
  const recipe = { name: "Wave Off", description: "They wave", seconds: 5, camera: "Static shot {place}", beats: [{ from: 0, to: 5, action: "They wave goodbye" }], sound: "wind" };
  const save = (app: Awaited<ReturnType<typeof testApp>>["app"], body: object, headers = {}) =>
    app.inject({ method: "POST", url: "/api/custom-effects", payload: body, headers });

  it("saves a recipe, renders it, and names the clip after it", async () => {
    const { app } = await testApp();
    const saved = await save(app, { recipe, remixOf: "vanish" });
    expect(saved.statusCode).toBe(201);
    const effect = saved.json();
    expect(effect.id).toMatch(/^custom:/);
    expect(effect.remixOf).toBe("vanish");
    const cookie = String(saved.headers["set-cookie"]).split(";")[0]!;

    const mine = await app.inject({ method: "GET", url: "/api/custom-effects", headers: { cookie } });
    expect(mine.json().map((e: { id: string }) => e.id)).toEqual([effect.id]);
    const others = await app.inject({ method: "GET", url: "/api/custom-effects" });
    expect(others.json()).toEqual([]);

    const body = multipart({ effect: effect.id }, [{ name: "character", data: await tinyJpeg(), filename: "a.jpg" }]);
    const res = await app.inject({ method: "POST", url: "/api/generations", ...body });
    expect(res.statusCode).toBe(202);
    expect(res.json().effectLabel).toBe("Wave Off");
    const row = await db.generation.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(row.prompt).toContain("0-5s: They wave goodbye.");
    const share = await app.inject({ method: "GET", url: `/v/${res.json().id}` });
    expect(share.body).toContain("Wave Off");
    await app.close();
  });

  it("opens shared links for anyone, and rejects bad recipes and unknown effects", async () => {
    const { app } = await testApp();
    const effect = (await save(app, { recipe })).json();
    const open = await app.inject({ method: "GET", url: `/api/custom-effects/${encodeURIComponent(effect.id)}` });
    expect(open.json().label).toBe("Wave Off");
    expect((await save(app, { recipe: { ...recipe, seconds: 99 } })).statusCode).toBe(400);
    expect((await save(app, {})).statusCode).toBe(400);
    const body = multipart({ effect: "custom:nope" }, [{ name: "character", data: await tinyJpeg(), filename: "a.jpg" }]);
    expect((await app.inject({ method: "POST", url: "/api/generations", ...body })).statusCode).toBe(400);
    await app.close();
  });

  it("limits saves per session", async () => {
    const { app } = await testApp();
    const first = await save(app, { recipe });
    const cookie = String(first.headers["set-cookie"]).split(";")[0]!;
    const results = [];
    for (let i = 0; i < 30; i++) results.push((await save(app, { recipe }, { cookie })).statusCode);
    expect(results.at(-1)).toBe(429);
    await app.close();
  });

  it("exports any effect as a ComfyUI workflow with images in order", async () => {
    const { app } = await testApp();
    const res = await app.inject({ method: "GET", url: "/api/effects/vanish/workflow?characters=2&products=1&aspectRatio=1:1&note=red%20coat" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("hypereel-vanish.json");
    const graph = res.json();
    const h3 = graph["2"].inputs;
    expect(h3["model.reference_images.image_3"]).toEqual(["ref_3", 0]);
    expect(h3["model.reference_images.image_4"]).toBeUndefined();
    expect(h3["model.prompt"]).toContain("Image 1 and Image 2 show the character");
    expect(h3["model.prompt"]).toContain("red coat");
    expect(h3["model.duration"]).toBe(5);
    expect(h3["model.ratio"]).toBe("1:1");
    expect(graph.ref_3._meta.title).toBe("Product 1");
    const custom = (await save(app, { recipe })).json();
    const wf = await app.inject({ method: "GET", url: `/api/effects/${encodeURIComponent(custom.id)}/workflow` });
    expect(wf.json()["2"].inputs["model.prompt"]).toContain("They wave goodbye");
    expect((await app.inject({ method: "GET", url: "/api/effects/vanish/workflow?characters=0" })).statusCode).toBe(400);
    await app.close();
  });

  it("opens any effect's recipe for remixing and previews a draft's prompt", async () => {
    const { app } = await testApp();
    const r = await app.inject({ method: "GET", url: "/api/effects/vanish/recipe" });
    expect(r.json().recipe.beats.length).toBeGreaterThan(1);
    const preview = await app.inject({ method: "POST", url: "/api/recipes/preview?locations=1", payload: { recipe } });
    expect(preview.json().prompt).toContain("Image 2 shows the location");
    expect((await app.inject({ method: "GET", url: "/api/community-recipes" })).json().length).toBeGreaterThanOrEqual(3);
    const gallery = (await app.inject({ method: "GET", url: "/api/effects" })).json();
    expect(gallery[9].id).toBe("gravity-flip");
    const community = await app.inject({ method: "GET", url: "/api/effects/gravity-flip/recipe" });
    expect(community.json().recipe.name).toBe("Gravity Flip");
    const body = multipart({ effect: "gravity-flip" }, [{ name: "character", data: await tinyJpeg(), filename: "a.jpg" }]);
    const res = await app.inject({ method: "POST", url: "/api/generations", ...body });
    expect(res.json().effectLabel).toBe("Gravity Flip");
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
