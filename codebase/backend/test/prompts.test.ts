import { describe, expect, it } from "vitest";
import { GENRES, buildPrompt, buildWriterBrief, sanitizeCaption } from "../src/prompts.js";

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
  it("writer brief carries genre, a punchline beat, length and the user note", () => {
    for (const g of GENRES) {
      expect(g.beats.length).toBeGreaterThanOrEqual(3);
      const b = buildWriterBrief(g.id, "Mochi, has never caught a mouse", 8, () => 0);
      expect(b).toContain(g.label);
      expect(b).toContain(g.beats[0]);
      expect(b).toContain("8 seconds");
      expect(b).toContain("Mochi, has never caught a mouse");
    }
  });
  it("writer brief picks different beats for different random draws", () => {
    const first = buildWriterBrief("trailer", "", 8, () => 0);
    const last = buildWriterBrief("trailer", "", 8, () => 0.999);
    expect(first).not.toBe(last);
    expect(first).toContain("find the joke in what you see");
  });
});
