import { describe, expect, it } from "vitest";
import { GENRES, buildPrompt, sanitizeCaption } from "../src/prompts.js";

describe("prompts", () => {
  it("every genre produces a prompt that references Image 1 and audio", () => {
    for (const g of GENRES) {
      const p = buildPrompt(g.id, "my cat Mochi");
      expect(p).toContain("Image 1");
      expect(p).toContain("my cat Mochi");
      expect(p.length).toBeLessThan(2000);
    }
  });
  it("works without a caption", () => {
    expect(buildPrompt("trailer")).toContain("the subject from the photo");
  });
  it("rejects unknown genres", () => {
    expect(() => buildPrompt("western")).toThrow(/Unknown genre/);
  });
  it("sanitizes captions (newlines, quotes, length)", () => {
    expect(sanitizeCaption('a "quoted"\nthing  here')).toBe("a quoted thing here");
    expect(sanitizeCaption("x".repeat(500)).length).toBe(120);
    expect(sanitizeCaption(undefined)).toBe("");
  });
});
