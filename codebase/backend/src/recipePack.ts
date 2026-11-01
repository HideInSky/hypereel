// Builds the files shared with comfyui-hypereel/. parity.json holds prompts computed by
// this code, and the Python test checks that nodes.py produces exactly the same ones.
import { buildPromptFor, getEffect, type Effect, type ReferenceRole } from "./effects.js";
import { effectFromRecipe, exportBuiltins } from "./recipes.js";
import { loadCommunityRecipes } from "./routes/customEffects.js";

const COUNTS = [[1, 0, 0], [2, 1, 1], [1, 0, 3], [4, 2, 3]] as const;
const BUILTIN_CASES = ["vanish", "floating-fall", "canvas", "tracking", "street-colossus", "superstar"];
const DIRECTION = "  make it\nraining,   with a red coat ";

const refs = ([c, l, p]: readonly number[]) => {
  const list: { role: ReferenceRole }[] = [];
  for (let i = 0; i < c!; i++) list.push({ role: "character" });
  for (let i = 0; i < l!; i++) list.push({ role: "location" });
  for (let i = 0; i < p!; i++) list.push({ role: "product" });
  return list;
};

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/** Output file, relative to backend/scripts, mapped to its contents. */
export function recipePackFiles(): Record<string, string> {
  const effects: Effect[] = [
    ...BUILTIN_CASES.map((id) => getEffect(id)!),
    ...loadCommunityRecipes().map(({ id, recipe }) => effectFromRecipe(id, recipe)),
  ];
  const cases = effects.flatMap((e) =>
    COUNTS.map((c) => ({ effect: e.id, counts: c, direction: DIRECTION, prompt: buildPromptFor(e, refs(c), "make it raining, with a red coat") })),
  );
  return {
    "../../../comfyui-hypereel/recipes/builtin.json": json(exportBuiltins()),
    "../../../comfyui-hypereel/tests/parity.json": json(cases),
  };
}
