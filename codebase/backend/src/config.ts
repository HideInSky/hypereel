// All runtime configuration comes from environment variables (12-factor).
// zod validates them once at startup so a misconfigured deploy fails loudly
// instead of at the first request.
import { z } from "zod";

const DEV_COOKIE_SECRET = "dev-only-cookie-secret-change-me";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  // Public base URL, used to build absolute share links / OG tags.
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  // Where uploads and rendered videos are stored (a mounted volume in prod).
  DATA_DIR: z.string().default("./data"),
  COOKIE_SECRET: z.string().min(16).default(DEV_COOKIE_SECRET),

  // --- Comfy / MiniMax H3 ---
  // "workflow": run the exported ComfyUI workflow JSON through Comfy Cloud (default).
  // "fake":     no network; returns a fixture video. For UI work and tests.
  COMFY_MODE: z.enum(["workflow", "fake"]).default("fake"),
  COMFY_API_KEY: z.string().optional(),
  COMFY_WORKFLOW_PATH: z.string().default("../../workflows/hypereel_effects_h3_api.json"),
  COMFY_WORKFLOW_MAP_PATH: z.string().default("../../workflows/hypereel_effects_h3_map.json"),

  // --- Credit protection: every clip costs real money ---
  LIMIT_PER_SESSION_PER_HOUR: z.coerce.number().default(3),
  LIMIT_PER_IP_PER_DAY: z.coerce.number().default(10),
  LIMIT_GLOBAL_PER_DAY: z.coerce.number().default(25),
  MAX_UPLOAD_MB: z.coerce.number().default(10),

  // Which request header holds the real client IP, set by your reverse proxy.
  // Leave empty when there is no proxy: the socket address is used, which can't be spoofed.
  // Never point this at a header clients can set themselves. On Railway it defaults to
  // x-real-ip, because Railway's edge writes that header.
  CLIENT_IP_HEADER: z.string().optional(),
  // A stuck render is marked failed after this long.
  JOB_TIMEOUT_MINUTES: z.coerce.number().default(15),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.COOKIE_SECRET === DEV_COOKIE_SECRET) {
    throw new Error("COOKIE_SECRET must be set in production. Anyone could forge sessions with the default.");
  }
  if (parsed.data.CLIENT_IP_HEADER === undefined && env.RAILWAY_PROJECT_ID) {
    parsed.data.CLIENT_IP_HEADER = "x-real-ip";
  }
  if (parsed.data.COMFY_MODE !== "fake" && !parsed.data.COMFY_API_KEY) {
    throw new Error("COMFY_API_KEY is required unless COMFY_MODE=fake");
  }
  return parsed.data;
}
