// ComfyUI graphs for stories, built in code so the app and the files in workflows/
// can't drift apart (scripts/export-workflows.ts writes those files from here).
// Node and input names were checked against Comfy Cloud's object_info.

export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } }>;

const H3_MODEL = "MiniMax H3 Max";
const randomSeed = () => Math.floor(Math.random() * 4_294_967_295);
const save = (from: string, prefix: string) => ({ class_type: "SaveVideo", inputs: { video: [from, 0], filename_prefix: prefix, format: "auto", "format.codec": "auto" }, _meta: { title: "Save video" } });

/**
 * Continue: H3 animates from a first frame (and optionally to a last frame). Used for a
 * shot after a clip (first frame = that clip's last frame, so the join is seamless) and
 * for a shot before one (last frame = that clip's first frame).
 */
export function continueGraph(p: { prompt: string; seconds: number; resolution: string; hasLastFrame: boolean }): Graph {
  return {
    first: { class_type: "LoadImage", inputs: { image: "first_frame.png" }, _meta: { title: "First frame" } },
    ...(p.hasLastFrame ? { last: { class_type: "LoadImage", inputs: { image: "last_frame.png" }, _meta: { title: "Last frame" } } } : {}),
    video: {
      class_type: "MinimaxHailuo03FirstLastFrameNode",
      _meta: { title: "MiniMax H3 Max (first and last frame)" },
      inputs: {
        model: H3_MODEL,
        "model.prompt": p.prompt,
        "model.resolution": p.resolution,
        "model.duration": p.seconds,
        "model.prompt_expansion_mode": "balanced",
        first_frame: ["first", 0],
        ...(p.hasLastFrame ? { last_frame: ["last", 0] } : {}),
        seed: randomSeed(),
        watermark: false,
      },
    },
    out: save("video", "hypereel_continue"),
  };
}

/**
 * A shot that leads into a clip. H3's first-last-frame node needs a first frame, so
 * Nano Banana draws one from the clip's first frame (same person and pose, new scene),
 * resized to the clip's exact size, and H3 animates from it to the clip's first frame.
 */
export function beforeGraph(p: { prompt: string; scenePrompt: string; seconds: number; resolution: string; width: number; height: number; ratio: string }): Graph {
  return {
    first: { class_type: "LoadImage", inputs: { image: "clip_first_frame.png" }, _meta: { title: "The clip's first frame" } },
    scene: {
      class_type: "GeminiNanoBanana2",
      _meta: { title: "Draw the opening frame" },
      inputs: { prompt: p.scenePrompt, images: ["first", 0], model: "Nano Banana 2 (Gemini 3.1 Flash Image)", seed: randomSeed() % 2_147_483_647, aspect_ratio: p.ratio, resolution: "1K", response_modalities: "IMAGE", thinking_level: "MINIMAL" },
    },
    fit: { class_type: "ImageScale", _meta: { title: "Match the clip's size" }, inputs: { image: ["scene", 0], upscale_method: "lanczos", width: p.width, height: p.height, crop: "center" } },
    video: {
      class_type: "MinimaxHailuo03FirstLastFrameNode",
      _meta: { title: "MiniMax H3 Max (first and last frame)" },
      inputs: {
        model: H3_MODEL,
        "model.prompt": p.prompt,
        "model.resolution": p.resolution,
        "model.duration": p.seconds,
        "model.prompt_expansion_mode": "balanced",
        first_frame: ["fit", 0],
        last_frame: ["first", 0],
        seed: randomSeed(),
        watermark: false,
      },
    },
    out: save("video", "hypereel_before"),
  };
}

/** Restage: same moves, new scene. The neighbouring clip goes in as Video 1. */
export function restageGraph(p: { prompt: string; seconds: number; resolution: string; ratio: string; imageTitles: string[] }): Graph {
  const images = Object.fromEntries(p.imageTitles.map((title, i) => [`img_${i + 1}`, { class_type: "LoadImage", inputs: { image: `image_${i + 1}.png` }, _meta: { title } }]));
  return {
    ...images,
    motion: { class_type: "LoadVideo", inputs: { file: "motion.mp4" }, _meta: { title: "Video 1: the moves to copy" } },
    video: {
      class_type: "MinimaxHailuo03ReferenceNode",
      _meta: { title: "MiniMax H3 Max (references)" },
      inputs: {
        model: H3_MODEL,
        "model.prompt": p.prompt,
        "model.resolution": p.resolution,
        "model.ratio": p.ratio,
        "model.duration": p.seconds,
        "model.prompt_expansion_mode": "balanced",
        "model.reference_detail": "standard",
        ...Object.fromEntries(p.imageTitles.map((_, i) => [`model.reference_images.image_${i + 1}`, [`img_${i + 1}`, 0]])),
        "model.reference_videos.video_1": ["motion", 0],
        seed: randomSeed(),
        watermark: false,
      },
    },
    out: save("video", "hypereel_restage"),
  };
}

/** Music from a description (Sonilo) or a sound effect (ElevenLabs), saved as MP3. */
export function audioGraph(p: { kind: "music" | "sfx"; prompt: string; seconds: number }): Graph {
  const make =
    p.kind === "music"
      ? { class_type: "SoniloTextToMusic", _meta: { title: "Music" }, inputs: { prompt: p.prompt, duration: Math.round(p.seconds), seed: 0 } }
      : {
          class_type: "ElevenLabsTextToSoundEffects",
          _meta: { title: "Sound effect" },
          inputs: { text: p.prompt, model: "eleven_sfx_v2", "model.duration": p.seconds, "model.loop": false, "model.prompt_influence": 0.5, output_format: "mp3_44100_192" },
        };
  return { make, out: { class_type: "SaveAudioMP3", inputs: { audio: ["make", 0], filename_prefix: `hypereel_${p.kind}`, quality: "V0" }, _meta: { title: "Save audio" } } };
}

/**
 * An image from Nano Banana 2, optionally from reference images (a character's photos,
 * other canvas cards). The images are uploaded at one shared size, so ImageBatch can
 * stack them without stretching.
 */
export function imageGraph(p: { prompt: string; ratio: string; references: number; resolution?: "1K" | "2K"; thinking?: "MINIMAL" | "HIGH" }): Graph {
  const graph: Graph = {};
  for (let i = 1; i <= p.references; i++) graph[`img_${i}`] = { class_type: "LoadImage", inputs: { image: `reference_${i}.png` }, _meta: { title: `Reference ${i}` } };
  let batch = p.references > 0 ? "img_1" : "";
  for (let i = 2; i <= p.references; i++) {
    graph[`batch_${i}`] = { class_type: "ImageBatch", inputs: { image1: [batch, 0], image2: [`img_${i}`, 0] }, _meta: { title: "Batch the references" } };
    batch = `batch_${i}`;
  }
  graph.make = {
    class_type: "GeminiNanoBanana2",
    _meta: { title: "Nano Banana 2" },
    inputs: {
      prompt: p.prompt,
      ...(batch ? { images: [batch, 0] } : {}),
      model: "Nano Banana 2 (Gemini 3.1 Flash Image)",
      seed: randomSeed() % 2_147_483_647,
      aspect_ratio: p.ratio,
      resolution: p.resolution ?? "1K",
      response_modalities: "IMAGE",
      thinking_level: p.thinking ?? "MINIMAL",
    },
  };
  graph.out = { class_type: "SaveImage", inputs: { images: ["make", 0], filename_prefix: "hypereel_image" }, _meta: { title: "Save image" } };
  return graph;
}

/** What a character sheet asks for. Kept here so the app and the example file match. */
export type SheetVariant = { outfit?: string; style?: string };

/**
 * A character sheet in the layout character-consistency workflows use: one wide image in
 * three panels. The front view leaves the head out so the outfit, build and proportions
 * read clearly; the back view shows hair and the back of the outfit; the close-up locks the
 * face. A flat mid-grey background keeps exposure neutral (white brightens the character,
 * black darkens it, and the video model carries that over). `identity` describes an
 * invented character once, up front. A variant changes only the outfit or the art style.
 */
export function sheetPrompt(p: { identity?: string | null; variant?: SheetVariant | null } = {}): string {
  const who = p.identity ? `the character in the reference images (${p.identity.replace(/[.\s]+$/, "")})` : "the person in the reference images";
  const outfit = p.variant?.outfit;
  const style = p.variant?.style;
  const lines = [
    `A character reference sheet of ${who}. One wide image split into three equal vertical panels side by side, with thin gaps between them.`,
    "Left panel: the full body from the front, standing straight with arms relaxed at the sides, cropped at the neck so the head is out of frame, showing the outfit, build and proportions clearly.",
    "Middle panel: the same full body seen from directly behind, head included, showing the hair and the back of the outfit.",
    "Right panel: a tight close-up of the face looking straight into the camera with a neutral expression, showing the exact face shape, eyes, nose, mouth, skin, hair and any marks.",
  ];
  if (outfit) lines.push(`Dress them in a new outfit: ${outfit}. Keep the face, hair, skin tone and body exactly the same as in the reference images; change only the clothes, the same in all three panels.`);
  if (style) lines.push(`Draw them in this art style: ${style}. Keep their key features (face shape, hairstyle and hair colour, skin tone, outfit and proportions) so they are clearly the same character.`);
  lines.push(
    "Every panel has the same flat, neutral mid-grey studio background with no shadows, soft even light and balanced exposure.",
    `The same face, hair, body and outfit in every panel.${style ? "" : " Photorealistic, sharp, high detail."} No text, no labels, no logos, no borders.`,
  );
  return lines.join(" ");
}

/** The base sheet prompt, for the example workflow file. */
export const SHEET_PROMPT = sheetPrompt();

/** Example copies for the workflows/ folder, to open in the ComfyUI editor. Seeds are fixed so the files are stable. */
export function exampleWorkflows(): Record<string, Graph> {
  const fixSeeds = (g: Graph): Graph => {
    for (const node of Object.values(g)) if ("seed" in node.inputs) node.inputs.seed = 42;
    return g;
  };
  return Object.fromEntries(Object.entries(examples()).map(([name, g]) => [name, fixSeeds(g)]));
}

function examples(): Record<string, Graph> {
  return {
    "hypereel_story_continue_after_api.json": continueGraph({ prompt: "Continue seamlessly from the first frame. The woman keeps dancing and switches to a hip-hop style. Static camera.", seconds: 5, resolution: "480P", hasLastFrame: false }),
    "hypereel_story_before_api.json": beforeGraph({ prompt: "She practises the same dance alone in her bedroom, and the room gradually turns into the dance studio, ending exactly on the last frame.", scenePrompt: "The same person, same outfit, same pose and framing, but in a small bedroom in soft morning light. Photorealistic. No text, no logos.", seconds: 5, resolution: "480P", width: 480, height: 832, ratio: "9:16" }),
    "hypereel_story_restage_api.json": restageGraph({ prompt: "Image 1 shows the character. Video 1 shows the moves. She performs exactly the same moves as in Video 1, with the same timing and framing, on a rainy city street at night.", seconds: 5, resolution: "480P", ratio: "9:16", imageTitles: ["Character 1"] }),
    "hypereel_story_music_api.json": audioGraph({ kind: "music", prompt: "Upbeat pop dance track, punchy drums, 118 BPM", seconds: 20 }),
    "hypereel_story_sfx_api.json": audioGraph({ kind: "sfx", prompt: "Steady rain on a city street at night", seconds: 10 }),
    "hypereel_canvas_character_sheet_api.json": imageGraph({ prompt: SHEET_PROMPT, ratio: "16:9", references: 2, resolution: "2K", thinking: "HIGH" }),
    "hypereel_canvas_image_api.json": imageGraph({ prompt: "A sunlit rooftop at golden hour, empty, wide shot. Photorealistic. No text, no logos.", ratio: "9:16", references: 0 }),
  };
}
