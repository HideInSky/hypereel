// Effect Studio's API: save a recipe, share it by link, remix any effect, preview the
// prompt, and export a ComfyUI workflow. Only rendering costs credits, and that still
// goes through POST /api/generations and its caps.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CustomEffect } from "@prisma/client";
import type { AppContext } from "../app.js";
import { EFFECTS, buildPromptFor, getEffect, previewUrl, sanitizeUserPrompt, type Effect, type ReferenceRole } from "../effects.js";
import { RecipeSchema, effectFromRecipe, recipeFromEffect, type Recipe } from "../recipes.js";
import { exportWorkflow } from "../services/comfy.js";

const CUSTOM_PREFIX = "custom:";
const SAVES_PER_SESSION_PER_DAY = 30;
const SAVES_PER_IP_PER_DAY = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const here = path.dirname(fileURLToPath(import.meta.url));
const COMMUNITY_DIR = path.resolve(here, "../..", "../../comfyui-hypereel/recipes/community");

/** Recipes contributed to the repo. Adding an effect is a JSON file in a pull request. */
export function loadCommunityRecipes(dir = COMMUNITY_DIR): { id: string; recipe: Recipe }[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return files.map((f) => ({ id: f.replace(/\.json$/, ""), recipe: RecipeSchema.parse(JSON.parse(readFileSync(path.join(dir, f), "utf8"))) }));
}

const customId = (id: string) => (id.startsWith(CUSTOM_PREFIX) ? id.slice(CUSTOM_PREFIX.length) : null);

const community = loadCommunityRecipes();

/** Community recipes as gallery entries. A clip appears once its file is in PREVIEWS. */
export const communityEffects = () =>
  community.map(({ id, recipe }) => ({
    id,
    label: recipe.name,
    description: recipe.description,
    seconds: recipe.seconds,
    preview: previewUrl(id),
    poster: previewUrl(id)?.replace(/\.mp4$/, ".jpg") ?? null,
    ratio: "9:16",
    community: true,
  }));

/** A built-in effect, a community recipe, or a saved custom one. */
export async function resolveEffect(ctx: AppContext, id: string): Promise<Effect | null> {
  const row = customId(id);
  if (row === null) {
    const shared = community.find((c) => c.id === id);
    return shared ? effectFromRecipe(id, shared.recipe) : (getEffect(id) ?? null);
  }
  const saved = await ctx.db.customEffect.findUnique({ where: { id: row } });
  return saved ? effectFromRecipe(id, RecipeSchema.parse(saved.recipe)) : null;
}

const toEffect = (row: CustomEffect) => {
  const recipe = RecipeSchema.parse(row.recipe);
  return {
    id: `${CUSTOM_PREFIX}${row.id}`,
    label: recipe.name,
    description: recipe.description,
    seconds: recipe.seconds,
    preview: null,
    poster: null,
    ratio: "3:4",
    custom: true,
    remixOf: row.remixOf,
  };
};

const firstProblem = (err: z.ZodError) => err.issues[0]?.message ?? "That recipe isn't valid.";

const countSchema = (max: number, min = 0) => z.coerce.number().int().min(min).max(max).default(min);
const workflowQuery = z.object({
  characters: countSchema(4, 1),
  locations: countSchema(2),
  products: countSchema(3),
  note: z.string().max(300).optional(),
  resolution: z.enum(["480P", "768P"]).default("480P"),
  aspectRatio: z.enum(["9:16", "3:4", "1:1", "16:9"]).default("9:16"),
});

const rolesFor = (q: { characters: number; locations: number; products: number }) => {
  const roles: { role: ReferenceRole; title: string }[] = [];
  const add = (role: ReferenceRole, n: number, name: string) => {
    for (let i = 1; i <= n; i++) roles.push({ role, title: `${name} ${i}` });
  };
  add("character", q.characters, "Character");
  add("location", q.locations, "Location");
  add("product", q.products, "Product");
  return roles;
};

export async function customEffectRoutes(app: FastifyInstance, ctx: AppContext) {
  const small = { bodyLimit: 32 * 1024 };

  app.get("/api/community-recipes", async () => community);

  // Compiles a draft without saving it, so the Studio can show the exact prompt as you type.
  app.post("/api/recipes/preview", small, async (req, reply) => {
    const parsed = RecipeSchema.safeParse((req.body as { recipe?: unknown } | null)?.recipe);
    if (!parsed.success) return reply.code(400).send({ error: firstProblem(parsed.error) });
    const q = workflowQuery.parse(req.query);
    const prompt = buildPromptFor(effectFromRecipe("draft", parsed.data), rolesFor(q));
    return { prompt };
  });

  app.post("/api/custom-effects", small, async (req, reply) => {
    const body = (req.body ?? {}) as { recipe?: unknown; remixOf?: unknown };
    const parsed = RecipeSchema.safeParse(body.recipe);
    if (!parsed.success) return reply.code(400).send({ error: firstProblem(parsed.error) });
    const remixOf = typeof body.remixOf === "string" ? body.remixOf.slice(0, 80) : null;

    const sessionId = ctx.getSessionId(req, reply);
    const ip = ctx.clientIp(req);
    const since = new Date(Date.now() - DAY_MS);
    const [mine, fromIp] = await Promise.all([
      ctx.db.customEffect.count({ where: { sessionId, createdAt: { gte: since } } }),
      ctx.db.customEffect.count({ where: { ip, createdAt: { gte: since } } }),
    ]);
    if (mine >= SAVES_PER_SESSION_PER_DAY || fromIp >= SAVES_PER_IP_PER_DAY) {
      return reply.code(429).send({ error: "That's a lot of new effects for one day. Try again tomorrow." });
    }
    const row = await ctx.db.customEffect.create({ data: { name: parsed.data.name, recipe: parsed.data, remixOf, sessionId, ip } });
    return reply.code(201).send(toEffect(row));
  });

  // This visitor's own effects. A custom effect is only reachable by its link, so there
  // is no public feed of user-written text to moderate.
  app.get("/api/custom-effects", async (req) => {
    const sessionId = ctx.readSessionId(req);
    if (!sessionId) return [];
    const rows = await ctx.db.customEffect.findMany({ where: { sessionId }, orderBy: { createdAt: "desc" }, take: 50 });
    return rows.map(toEffect);
  });

  app.get<{ Params: { id: string } }>("/api/custom-effects/:id", async (req, reply) => {
    const row = await ctx.db.customEffect.findUnique({ where: { id: customId(req.params.id) ?? req.params.id } });
    if (!row) return reply.code(404).send({ error: "Not found" });
    return toEffect(row);
  });

  // The editable recipe behind any effect. This is what "Remix" opens.
  app.get<{ Params: { id: string } }>("/api/effects/:id/recipe", async (req, reply) => {
    const row = customId(req.params.id);
    if (row !== null) {
      const saved = await ctx.db.customEffect.findUnique({ where: { id: row } });
      return saved ? { recipe: RecipeSchema.parse(saved.recipe) } : reply.code(404).send({ error: "Not found" });
    }
    const shared = community.find((c) => c.id === req.params.id);
    if (shared) return { recipe: shared.recipe };
    const effect = EFFECTS.find((e) => e.id === req.params.id);
    return effect ? { recipe: recipeFromEffect(effect) } : reply.code(404).send({ error: "Not found" });
  });

  // Any effect as a normal ComfyUI workflow, with the prompt filled in for these inputs.
  app.get<{ Params: { id: string } }>("/api/effects/:id/workflow", async (req, reply) => {
    const q = workflowQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "Those workflow options aren't valid." });
    const effect = await resolveEffect(ctx, req.params.id);
    if (!effect) return reply.code(404).send({ error: "Not found" });
    const roles = rolesFor(q.data);
    const graph = await exportWorkflow(ctx.cfg, {
      prompt: buildPromptFor(effect, roles, sanitizeUserPrompt(q.data.note)),
      seconds: effect.seconds,
      resolution: q.data.resolution,
      aspectRatio: q.data.aspectRatio,
      imageTitles: roles.map((r) => r.title),
    });
    const name = effect.id.replace(/[^a-z0-9-]+/gi, "-");
    return reply.header("Content-Disposition", `attachment; filename="hypereel-${name}.json"`).type("application/json").send(graph);
  });
}
