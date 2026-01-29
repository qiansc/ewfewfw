/**
 * Post-install script to copy WASM files
 * Run after npm/bun install
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const wasmDir = join(projectRoot, "wasm");

// Ensure wasm directory exists
if (!existsSync(wasmDir)) {
  mkdirSync(wasmDir, { recursive: true });
}

// Copy web-tree-sitter WASM
const treeSitterWasm = join(
  projectRoot,
  "node_modules",
  "web-tree-sitter",
  "tree-sitter.wasm"
);

if (existsSync(treeSitterWasm)) {
  copyFileSync(treeSitterWasm, join(wasmDir, "tree-sitter.wasm"));
  console.log("Copied tree-sitter.wasm");
}

// Language WASM files - note: these need to be built or obtained separately
// tree-sitter-typescript/go/python don't include pre-built WASM files
// For now, we'll check if they exist and warn if not
const languageWasmFiles = [
  "tree-sitter-typescript.wasm",
  "tree-sitter-tsx.wasm",
  "tree-sitter-go.wasm",
  "tree-sitter-python.wasm",
];

for (const wasmFile of languageWasmFiles) {
  const destPath = join(wasmDir, wasmFile);
  if (!existsSync(destPath)) {
    console.warn(
      `Warning: ${wasmFile} not found. Language support may be limited.`
    );
    console.warn(
      `You may need to build or download WASM files from https://github.com/nicolo-ribaudo/nicolo-ribaudo.github.io/tree/master/tree-sitter-wasm/tree-sitter-playground`
    );
  }
}

console.log("WASM setup complete");
