// The open effect format, "hypereel-effect/1": an effect as plain JSON, so it can be
// written in Effect Studio, shared by link, sent as a pull request, or run inside
// ComfyUI with the custom node in comfyui-hypereel/. nodes.py mirrors compileMotion.
import { z } from "zod";
import { EFFECTS, type Effect, type EffectContext } from "./effects.js";

export const RECIPE_FORMAT = "hypereel-effect/1";
const PLACE_TOKEN = "{place}";
const NO_LOCATION = "in a setting that suits the photo";
const WITH_LOCATION = "at the location from the location image";

const oneLine = (max: number) =>
  z.string().transform((t) => t.replace(/\s+/g, " ").trim()).pipe(z.string().max(max));

export const RecipeSchema = z
  .object({
    format: z.literal(RECIPE_FORMAT).default(RECIPE_FORMAT),
    name: oneLine(40).pipe(z.string().min(1, "Give the effect a name.")),
    description: oneLine(140).default(""),
    seconds: z.union([z.literal(5), z.literal(6), z.literal(8)]),
    look: z.enum(["photoreal", "stylized"]).default("photoreal"),
    /** How the shot is framed and moves. Use {place} for where it happens. */
    camera: oneLine(300).default(""),
    /** What happens when. */
    beats: z
      .array(z.object({ from: z.number().min(0).max(8), to: z.number().min(0).max(8), action: oneLine(800).pipe(z.string().min(1, "Describe what happens in each beat.")) }))
      .min(1, "Add at least one beat.")
      .max(6, "Six beats at most."),
    /** Added only when product photos are uploaded. */
    product: oneLine(300).default(""),
    sound: oneLine(300).default(""),
  })
  .superRefine((r, ctx) => {
    r.beats.forEach((b, i) => {
      if (b.from >= b.to) ctx.addIssue({ code: "custom", path: ["beats", i], message: "A beat must end after it starts." });
      if (b.to > r.seconds) ctx.addIssue({ code: "custom", path: ["beats", i], message: `A beat can't run past the ${r.seconds}s clip.` });
      const prev = r.beats[i - 1];
      if (prev && b.from < prev.from) ctx.addIssue({ code: "custom", path: ["beats", i], message: "Beats must be in time order." });
    });
  });

export type Recipe = z.infer<typeof RecipeSchema>;

const sentence = (t: string) => (t && !/[.!?]$/.test(t) ? `${t}.` : t);

/** Turns a recipe into the timed motion text the model reads. */
export function compileMotion(r: Recipe, ctx: EffectContext): string {
  const parts = [
    sentence(r.camera),
    ...r.beats.map((b) => `${b.from}-${b.to}s: ${sentence(b.action)}`),
    ctx.hasProducts ? sentence(r.product) : "",
    r.sound ? `Sound: ${sentence(r.sound)}` : "",
  ];
  return parts.filter(Boolean).join(" ").replaceAll(PLACE_TOKEN, ctx.hasLocation ? WITH_LOCATION : NO_LOCATION);
}

export function effectFromRecipe(id: string, r: Recipe): Effect {
  return { id, label: r.name, description: r.description, seconds: r.seconds, stylized: r.look === "stylized", motion: (ctx) => compileMotion(r, ctx) };
}

/** What a product photo adds to the text, if it only inserts words. */
function insertedText(without: string, withIt: string): string {
  let start = 0;
  while (start < without.length && without[start] === withIt[start]) start++;
  let end = 0;
  while (end < without.length - start && without[without.length - 1 - end] === withIt[withIt.length - 1 - end]) end++;
  return start + end === without.length ? withIt.slice(start, withIt.length - end).trim() : "";
}

/** Turns a built-in effect into an editable recipe, which is what makes it remixable. */
export function recipeFromEffect(e: Effect): Recipe {
  const base = e.motion({ hasLocation: false, hasProducts: false });
  const product = insertedText(base, e.motion({ hasLocation: false, hasProducts: true }));
  const text = base.replaceAll(NO_LOCATION, PLACE_TOKEN);
  const soundAt = text.lastIndexOf("Sound:");
  const body = (soundAt >= 0 ? text.slice(0, soundAt) : text).trim();
  const sound = soundAt >= 0 ? text.slice(soundAt + "Sound:".length).trim() : "";

  const marks = [...body.matchAll(/(\d+)-(\d+)s:\s*/g)];
  const beats = marks.map((m, i) => ({
    from: Number(m[1]),
    to: Number(m[2]),
    action: body.slice(m.index + m[0].length, marks[i + 1]?.index ?? body.length).trim(),
  }));
  return RecipeSchema.parse({
    name: e.label,
    description: e.description,
    seconds: e.seconds,
    look: e.stylized ? "stylized" : "photoreal",
    camera: marks[0] ? body.slice(0, marks[0].index).trim() : "",
    beats: beats.length > 0 ? beats : [{ from: 0, to: e.seconds, action: body }],
    product,
    sound,
  });
}

/** Everything the node pack needs about the built-in effects, as plain data. */
export function exportBuiltins() {
  return EFFECTS.map((e) => ({
    id: e.id,
    label: e.label,
    seconds: e.seconds,
    ownSetting: Boolean(e.ownSetting),
    stylized: Boolean(e.stylized),
    overlayText: Boolean(e.overlayText),
    motion: {
      none: e.motion({ hasLocation: false, hasProducts: false }),
      location: e.motion({ hasLocation: true, hasProducts: false }),
      products: e.motion({ hasLocation: false, hasProducts: true }),
      both: e.motion({ hasLocation: true, hasProducts: true }),
    },
  }));
}

