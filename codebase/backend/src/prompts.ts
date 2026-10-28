// Genre templates. MiniMax H3 generates video, voiceover, music and SFX in ONE
// pass, so the prompt describes all of them together. Each template is written
// as a tiny screenplay: visual direction + narrator line + sound design.
// "{subject}" is replaced with the user's caption (or a neutral fallback).

export interface Genre {
  id: string;
  label: string;
  emoji: string;
  tagline: string;
  build: (subject: string) => string;
}

const BASE =
  "Image 1 is the hero subject of the shot. Keep the subject's exact appearance, colors and setting from the photo. " +
  "Cinematic 5 second clip, 24fps, high quality, no on-screen text, no subtitles, no watermark.";

export const GENRES: Genre[] = [
  {
    id: "trailer",
    label: "Action Trailer",
    emoji: "🎬",
    tagline: "In a world...",
    build: (s) =>
      `${BASE} Style: blockbuster movie trailer. Slow dramatic push-in on ${s}, lens flares, dust in the air, ` +
      `then a quick dramatic cut to a low-angle hero shot. A deep gravelly male movie-trailer narrator says: ` +
      `"In a world... where nothing is what it seems... one legend rises." Epic orchestral trailer music with a ` +
      `braaam hit at the end, thunder rumble, cinematic riser.`,
  },
  {
    id: "nature",
    label: "Nature Documentary",
    emoji: "🌿",
    tagline: "Here, in its natural habitat...",
    build: (s) =>
      `${BASE} Style: BBC-style wildlife documentary. Steady telephoto shot of ${s}, shallow depth of field, ` +
      `gentle natural light, subtle slow zoom. A calm, warm, elderly British narrator whispers with awe: ` +
      `"And here, in its natural habitat, the majestic creature prepares for the most important moment of its day." ` +
      `Ambient birdsong, soft wind, light orchestral strings.`,
  },
  {
    id: "infomercial",
    label: "Infomercial",
    emoji: "📺",
    tagline: "But wait, there's more!",
    build: (s) =>
      `${BASE} Style: cheesy 1990s late-night TV infomercial. Bright flat studio lighting, ${s} slowly rotating ` +
      `on a turntable with sparkle glints, then a quick zoom. An over-excited American announcer shouts: ` +
      `"Are YOU tired of boring? Introducing the solution you never knew you needed! But wait, there's more!" ` +
      `Upbeat cheesy synth jingle, cash-register ding, sparkle sound effect.`,
  },
  {
    id: "kdrama",
    label: "K-Drama",
    emoji: "💔",
    tagline: "Rain. Tears. A slow turn.",
    build: (s) =>
      `${BASE} Style: emotional Korean drama climax. Soft rain falling, ${s} in a slow dolly shot, warm backlight, ` +
      `rain drops on the lens, a slow dramatic turn toward the camera. A soft, trembling female voice says in ` +
      `Korean: "왜... 왜 이제야 왔어?" Melancholic piano ballad swelling, rain ambience, a soft gasp.`,
  },
  {
    id: "horror",
    label: "Horror",
    emoji: "🕯️",
    tagline: "It was already there.",
    build: (s) =>
      `${BASE} Style: psychological horror film. Dim flickering light, handheld camera slowly creeping toward ${s}, ` +
      `deep shadows, a sudden subtle flicker. A hushed, trembling male narrator whispers: ` +
      `"We thought we were alone. We were wrong. It was already there." Low droning strings, creaking wood, ` +
      `a heartbeat, a sharp sting at the end.`,
  },
  {
    id: "cooking",
    label: "Cooking Show",
    emoji: "👨‍🍳",
    tagline: "Tonight's signature dish.",
    build: (s) =>
      `${BASE} Style: glossy food-network cooking competition. Warm golden kitchen lighting, ${s} presented on a ` +
      `countertop, slow orbit camera move with steam and sparkle. An energetic, enthusiastic male host announces: ` +
      `"And tonight's signature dish... absolutely stunning. The judges are speechless!" ` +
      `Upbeat kitchen-show music, sizzling pan, applause and a cheering crowd.`,
  },
];

export const GENRE_IDS = GENRES.map((g) => g.id);

export function getGenre(id: string): Genre | undefined {
  return GENRES.find((g) => g.id === id);
}

/** Clean the user caption so it can't break the template or smuggle in junk. */
export function sanitizeCaption(caption: string | undefined | null): string {
  if (!caption) return "";
  return caption.replace(/[\r\n"]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function buildPrompt(genreId: string, caption?: string | null): string {
  const genre = getGenre(genreId);
  if (!genre) throw new Error(`Unknown genre: ${genreId}`);
  const clean = sanitizeCaption(caption);
  const subject = clean ? `the subject from the photo (${clean})` : "the subject from the photo";
  return genre.build(subject);
}
