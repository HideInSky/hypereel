// Regenerates the data the ComfyUI node pack reads. Run after changing effects.ts:
//   npm run export-recipes -w codebase/backend
// A test fails if you forget, so the app and the node can't drift apart.
import { promises as fs } from "node:fs";
import { recipePackFiles } from "../src/recipePack.js";

for (const [url, text] of Object.entries(recipePackFiles())) await fs.writeFile(new URL(url, import.meta.url), text);
console.log("Wrote comfyui-hypereel/recipes/builtin.json and tests/parity.json.");
