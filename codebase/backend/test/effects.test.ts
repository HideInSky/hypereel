import { describe, expect, it } from "vitest";
import { EFFECTS, buildEffectPrompt, previewUrl, sanitizeUserPrompt, tileRatio } from "../src/effects.js";
import { SHOWCASE } from "../src/showcase.js";
import { PROMPT_MAX } from "../src/textLimits.js";
import { RecipeSchema, compileMotion, recipeFromEffect } from "../src/recipes.js";
import { recipePackFiles } from "../src/recipePack.js";
import { loadCommunityRecipes } from "../src/routes/customEffects.js";
import { withNetworkRetry, withReferenceSlots } from "../src/services/comfy.js";
import { toPlayback } from "../src/services/transcode.js";

describe("effect prompts", () => {
  it("numbers images in attachment order, by role", () => {
    const p = buildEffectPrompt("vanish", [{ role: "character" }, { role: "character" }, { role: "location" }, { role: "product" }]);
    expect(p).toContain("Image 1 and Image 2 show the character");
    expect(p).toContain("Image 3 shows the location");
    expect(p).toContain("Image 4 shows the product items");
  });
  it("every effect works with only a character", () => {
    for (const e of EFFECTS) {
      const p = buildEffectPrompt(e.id, [{ role: "character" }]);
      expect(p).toContain("Image 1 shows the character");
      expect(p).not.toContain("Image 2");
      expect(p).not.toMatch(/location image|product images/);
    }
  });
  it("uses location and products inside the effect when given", () => {
    const p = buildEffectPrompt("eyes-in", [{ role: "character" }, { role: "location" }, { role: "product" }]);
    expect(p).toContain("the location from the location image");
    expect(p).toContain("product items from the product images");
  });
  it("adds the user's direction and rejects unknown effects", () => {
    expect(buildEffectPrompt("vanish", [{ role: "character" }], "wearing a red coat")).toContain("wearing a red coat");
    expect(() => buildEffectPrompt("nope", [{ role: "character" }])).toThrow(/Unknown effect/);
  });
  it("only allows on-screen text for overlay effects", () => {
    expect(buildEffectPrompt("tracking", [{ role: "character" }])).toContain("only on-screen text is the overlay");
    expect(buildEffectPrompt("vanish", [{ role: "character" }])).toContain("No on-screen text");
    expect(buildEffectPrompt("comic", [{ role: "character" }])).not.toContain("Photorealistic");
  });
  it("sanitizes the user prompt", () => {
    expect(sanitizeUserPrompt(" a\nb  c ")).toBe("a b c");
    expect(sanitizeUserPrompt("x".repeat(PROMPT_MAX + 500)).length).toBe(PROMPT_MAX);
    expect(sanitizeUserPrompt(undefined)).toBe("");
  });
});

describe("gallery order", () => {
  it("puts the showcase first, then other clips, then effects without one", () => {
    const showcase = Object.keys(SHOWCASE);
    expect(EFFECTS.slice(0, showcase.length).map((e) => e.id)).toEqual(showcase);
    const rest = EFFECTS.slice(showcase.length).map((e) => Boolean(previewUrl(e.id)));
    expect(rest).toEqual([...rest].sort((a, b) => Number(b) - Number(a)));
  });
  it("keeps every clip in the shape it was rendered at", () => {
    expect(tileRatio("particles")).toBe("1:1");
    expect(tileRatio("vanish")).toBe("9:16");
  });
});

describe("workflow reference slots", () => {
  const map = { video: "2", prompt: "", duration: "", resolution: "", ratio: "", seed: "", referencePrefix: "refs.image_", output: "3", modelLabel: "x" };
  const template = {
    "10": { class_type: "LoadImage", inputs: { image: "a.png" } },
    "2": { class_type: "H3", inputs: { "refs.image_1": ["10", 0], seed: 1 } },
    "3": { class_type: "SaveVideo", inputs: { video: ["2", 0] } },
  };
  it("replaces the example loaders with one per upload, wired in order", () => {
    const { graph, loaders } = withReferenceSlots(template, map, 3);
    expect(loaders).toEqual(["ref_1", "ref_2", "ref_3"]);
    expect(graph["10"]).toBeUndefined();
    expect(graph["2"]!.inputs["refs.image_3"]).toEqual(["ref_3", 0]);
    expect(template["10"]).toBeDefined(); // template untouched
  });
});

describe("transcode", () => {
  it("compresses video, moves the index to the front, and rejects garbage", async () => {
    const { spawnSync } = await import("node:child_process");
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { default: ffmpeg } = await import("ffmpeg-static");
    const dir = mkdtempSync(path.join(tmpdir(), "hypereel-t-"));
    const source = path.join(dir, "s.mp4");
    // High-bitrate noise with no faststart, like the model's output but smaller.
    spawnSync(ffmpeg as unknown as string, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=480x832:r=24:d=1", "-c:v", "libx264", "-qp", "4", source]);
    const original = new Uint8Array(readFileSync(source));
    const out = await toPlayback(original);
    expect(out.length).toBeLessThan(original.length / 2);
    expect(Buffer.from(out).indexOf("moov")).toBeLessThan(Buffer.from(out).indexOf("mdat"));
    await expect(toPlayback(new TextEncoder().encode("not a video"))).rejects.toThrow(/ffmpeg/);
  }, 30_000);
});

describe("withNetworkRetry", () => {
  it("retries dropped connections, then succeeds", async () => {
    let calls = 0;
    const out = await withNetworkRetry(async () => {
      if (++calls < 3) throw new TypeError("fetch failed");
      return "ok";
    }, 3, 1);
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });
  it("does not retry real errors, and gives up after the limit", async () => {
    let calls = 0;
    await expect(withNetworkRetry(async () => { calls++; throw new Error("rejected"); }, 3, 1)).rejects.toThrow("rejected");
    expect(calls).toBe(1);
    await expect(withNetworkRetry(async () => { throw new TypeError("fetch failed"); }, 2, 1)).rejects.toThrow("fetch failed");
  });
});

describe("recipes", () => {
  const recipe = { name: "Test", seconds: 5, camera: "Static shot {place}", beats: [{ from: 0, to: 5, action: "They wave" }], product: "They hold the product", sound: "wind" };
  it("compiles beats, place, product and sound", () => {
    const r = RecipeSchema.parse(recipe);
    expect(compileMotion(r, { hasLocation: false, hasProducts: false })).toBe("Static shot in a setting that suits the photo. 0-5s: They wave. Sound: wind.");
    expect(compileMotion(r, { hasLocation: true, hasProducts: true })).toBe("Static shot at the location from the location image. 0-5s: They wave. They hold the product. Sound: wind.");
  });
  it("rejects beats outside the clip or out of order", () => {
    expect(RecipeSchema.safeParse({ ...recipe, beats: [{ from: 0, to: 6, action: "x" }] }).success).toBe(false);
    expect(RecipeSchema.safeParse({ ...recipe, beats: [{ from: 3, to: 2, action: "x" }] }).success).toBe(false);
    expect(RecipeSchema.safeParse({ ...recipe, beats: [{ from: 2, to: 3, action: "x" }, { from: 0, to: 1, action: "y" }] }).success).toBe(false);
    expect(RecipeSchema.safeParse({ ...recipe, seconds: 7 }).success).toBe(false);
    expect(RecipeSchema.safeParse({ ...recipe, name: "  " }).success).toBe(false);
  });
  it("can open every built-in effect as an editable recipe", () => {
    for (const e of EFFECTS) {
      const r = recipeFromEffect(e);
      const compiled = compileMotion(r, { hasLocation: false, hasProducts: false });
      const words = (t: string) => t.toLowerCase().replace(/\d+-\d+s:/g, " ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").sort();
      expect(words(compiled), e.id).toEqual(words(e.motion({ hasLocation: false, hasProducts: false })));
    }
  });
  it("finds what a product photo adds, and uses the location token", () => {
    const melting = recipeFromEffect(EFFECTS.find((e) => e.id === "melting")!);
    expect(melting.product).toBe("The product items sink slowly into the puddle.");
    expect(melting.camera).toContain("{place}");
  });
  it("loads the community recipes, and the node pack's files are up to date", async () => {
    expect(loadCommunityRecipes().map((c) => c.id)).toEqual(expect.arrayContaining(["gravity-flip", "paper-fold", "pocket-world"]));
    const { readFileSync } = await import("node:fs");
    for (const [rel, text] of Object.entries(recipePackFiles())) {
      const file = new URL(rel, new URL("../scripts/", import.meta.url));
      expect(readFileSync(file, "utf8"), `${rel} is stale: run npm run export-recipes`).toBe(text);
    }
  });
});
