import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repoRoot = resolve(scriptDir, "../../..");
const sourceDir = resolve(repoRoot, "prompts/skills");
const targetDir = resolve(repoRoot, "packages/cli/dist/skills");

async function syncSkills(): Promise<void> {
  await rm(targetDir, { recursive: true, force: true });
  await cp(sourceDir, targetDir, { recursive: true });
}

await syncSkills();
