import type {
  CodeMetrics,
  ExtractedExport,
  ExtractedImport,
  ExtractedInterface,
  ExtractedMethod,
} from "../types/index.js";

export function calculateMetrics(
  content: string,
  interfaces: ExtractedInterface[],
  functions: ExtractedMethod[],
  imports: ExtractedImport[],
  exports: ExtractedExport[]
): CodeMetrics {
  const lines = content.split("\n");
  const linesOfCode = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("#");
  }).length;

  return {
    lines: lines.length,
    linesOfCode,
    functions: functions.length,
    classes: interfaces.filter((i) => i.kind === "class").length,
    interfaces: interfaces.filter(
      (i) => i.kind === "interface" || i.kind === "type"
    ).length,
    imports: imports.length,
    exports: exports.length,
  };
}
