// How long the text people write can be. These are not model limits: ComfyUI's MiniMax H3 Max
// node takes prompts up to 50,000 characters and the Nano Banana node has no cap. They only
// keep a request from carrying megabytes of text. frontend/src/textLimits.ts mirrors them.
import { z } from "zod";

/** A full prompt: a character, an image, a video, the action in a story shot. */
export const PROMPT_MAX = 5000;
/** A detail that fills one slot in our own prompt: an outfit, an art style, a place, the light. */
export const DETAIL_MAX = 1000;

/** Tidies spaces but keeps line breaks, so paragraphs reach the model as they were written. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Multi-line text, tidied, at most `max` characters. */
export const promptText = (max = PROMPT_MAX) =>
  z.string().transform(tidyText).pipe(z.string().max(max, `Keep it to ${max.toLocaleString("en-US")} characters or fewer.`));
