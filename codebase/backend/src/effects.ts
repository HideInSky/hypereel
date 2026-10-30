// The fixed set of effects. An effect is a recipe: a motion description, a clip
// length, and rules for how the uploaded references are used. The user supplies
// the "who/where/what" (character, location, products); the recipe supplies the
// "what happens". MiniMax H3's reference node receives the images in a fixed
// order, and the prompt calls them "Image 1", "Image 2"... by that order.

export type ReferenceRole = "character" | "location" | "product";

export interface EffectContext {
  hasLocation: boolean;
  hasProducts: boolean;
}

export interface Effect {
  id: string;
  label: string;
  /** One line shown in the UI. */
  description: string;
  seconds: number;
  /** Example clip made by this project (not third-party footage). */
  preview: string;
  motion: (ctx: EffectContext) => string;
}

export const EFFECTS: Effect[] = [
  {
    id: "floating-fall",
    label: "Floating Fall",
    description: "They fall backward while their things hang in midair, and the camera glides through close-ups before the fall resumes.",
    seconds: 8,
    preview: "/effects/floating-fall.mp4",
    motion: ({ hasProducts }) => {
      const items = hasProducts
        ? "the product items from the product images, plus small personal belongings"
        : "their personal belongings, the things they would plausibly carry";
      return (
        "One continuous handheld shot. 0-2s: the character walks toward the camera in natural daylight, relaxed, then trips and tips backward, arms flung up. " +
        `2-6s: time slows to almost a freeze with the character suspended mid-fall, and ${items} drift weightlessly in the air around them, turning slowly. ` +
        "The camera glides forward past the character and passes very close to each floating item in a crisp macro close-up with shallow depth of field, the character blurred behind. " +
        "6-8s: the camera pulls back, time eases forward, and the character keeps falling in graceful slow motion. " +
        "Sound: street ambience turns muffled when time slows, soft airy whooshes as items pass the lens, a light dreamy synth note."
      );
    },
  },
  {
    id: "vanish",
    label: "Vanish",
    description: "Their body disappears in an instant, and the empty clothes collapse flat to the ground.",
    seconds: 5,
    preview: "/effects/vanish.mp4",
    motion: ({ hasProducts }) =>
      "Locked-off camera, no camera movement. 0-2s: the character stands fully dressed and calm, looking at the camera, with a small natural movement. " +
      "At exactly 2s their body vanishes in a single frame, with no dust, no particles, no fade and no glow. " +
      "The empty clothing keeps its shape in the air for a split second, as if still worn, then drops straight down under gravity and collapses in a flat heap of fabric on the ground" +
      (hasProducts ? ", with the product items dropping and landing on top of the clothes." : ", with any accessories landing on top.") +
      " 3-5s: the empty clothes settle, sleeves flopping, and nothing else moves. No skin or body is visible after the vanish. " +
      "Sound: quiet ambience, a soft fabric thump as the clothes land, then a beat of comic silence.",
  },
  {
    id: "eyes-in",
    label: "Eyes In",
    description: "The camera dives into their eye and through the pupil, then emerges in a whole new scene.",
    seconds: 8,
    preview: "/effects/eyes-in.mp4",
    motion: ({ hasLocation, hasProducts }) => {
      const scene = hasLocation
        ? "the location from the location image, wide and cinematic"
        : "a vast surreal dreamlike landscape that suits the character's mood";
      const product = hasProducts ? " The product items from the product images sit in that new scene as its focal point." : "";
      return (
        "One continuous unbroken camera move. 0-3s: starting on a close portrait of the character, the camera accelerates straight toward one eye. " +
        "Skin, lashes and iris fibres fill the frame in extreme macro detail, with the pupil's reflection glinting. " +
        "3-5s: the camera passes through the pupil into total darkness, with the black void rushing past and faint specks of light. " +
        `5-8s: the darkness opens seamlessly and the camera flies out into ${scene}, slowing to a gentle glide.${product} ` +
        "Sound: a low rising whoosh, a deep heartbeat inside the dark, then an airy open reverb and a soft swell of music as the new scene appears."
      );
    },
  },
];

export const EFFECT_IDS = EFFECTS.map((e) => e.id);

export function getEffect(id: string): Effect | undefined {
  return EFFECTS.find((e) => e.id === id);
}

/** Clean the optional user prompt so it stays one short line. */
export function sanitizeUserPrompt(text: string | undefined | null): string {
  if (!text) return "";
  return text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Reference images in the exact order they are attached to the H3 node. */
export interface OrderedReference {
  role: ReferenceRole;
}

/** Turns "Image 1, Image 2" position numbers into a sentence the model can follow. */
function describeRole(refs: OrderedReference[], role: ReferenceRole, text: string): string {
  const numbers = refs.flatMap((r, i) => (r.role === role ? [`Image ${i + 1}`] : []));
  if (numbers.length === 0) return "";
  const list = numbers.length === 1 ? numbers[0] : `${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`;
  return `${list} ${numbers.length === 1 ? "shows" : "show"} ${text}`;
}

/** Builds the final H3 prompt from the recipe, the reference roles and the user's note. */
export function buildEffectPrompt(effectId: string, refs: OrderedReference[], userPrompt?: string | null): string {
  const effect = getEffect(effectId);
  if (!effect) throw new Error(`Unknown effect: ${effectId}`);
  const has = (role: ReferenceRole) => refs.some((r) => r.role === role);
  const lines = [
    describeRole(refs, "character", "the character. Keep their face, build, hair and outfit exactly the same throughout."),
    describeRole(refs, "location", "the location. Set the scene there and match its light."),
    describeRole(refs, "product", "the product items. Keep their exact shape, color and details."),
    has("location") ? "" : "Set the scene in a location that suits the character's photo.",
    effect.motion({ hasLocation: has("location"), hasProducts: has("product") }),
    sanitizeUserPrompt(userPrompt) ? `Additional direction from the user: ${sanitizeUserPrompt(userPrompt)}.` : "",
    "Photorealistic, cinematic, safe for work. No on-screen text, no subtitles, no logos, no watermark.",
  ];
  return lines.filter(Boolean).join(" ");
}
