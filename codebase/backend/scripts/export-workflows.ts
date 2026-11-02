// Writes the story workflows into workflows/, so they can be opened in the ComfyUI editor.
// Run after changing src/services/workflows.ts:  npm run export-workflows -w codebase/backend
// A test fails if you forget.
import { promises as fs } from "node:fs";
import { exampleWorkflows } from "../src/services/workflows.js";

for (const [name, graph] of Object.entries(exampleWorkflows())) {
  await fs.writeFile(new URL(`../../../workflows/${name}`, import.meta.url), `${JSON.stringify(graph, null, 2)}\n`);
}
console.log("Wrote the story workflows to workflows/.");
