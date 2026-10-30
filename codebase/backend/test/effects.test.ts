import { describe, expect, it } from "vitest";
import { EFFECTS, buildEffectPrompt, sanitizeUserPrompt } from "../src/effects.js";
import { withNetworkRetry, withReferenceSlots } from "../src/services/comfy.js";

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
  it("sanitizes the user prompt", () => {
    expect(sanitizeUserPrompt(" a\nb  c ")).toBe("a b c");
    expect(sanitizeUserPrompt("x".repeat(500)).length).toBe(300);
    expect(sanitizeUserPrompt(undefined)).toBe("");
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
