/**
 * Mermaid 图表渲染器
 *
 * 将 Mermaid 代码渲染为 SVG/PNG
 */
import type { RenderChartInput } from "../schemas/inputSchemas.js";

export interface MermaidRenderOptions {
  code: string;
  type: string;
  output_format: "svg" | "png";
  theme: string;
}

export interface MermaidRenderResult {
  content: string;
  format: string;
  type: string;
}

/**
 * 渲染 Mermaid 图表
 *
 * 注意：由于 Bun 环境下 mermaid 渲染的限制，
 * 这里采用生成 Mermaid 代码 + 在线渲染服务的方式
 */
export async function renderMermaid(
  options: MermaidRenderOptions
): Promise<MermaidRenderResult> {
  const { code, type, output_format, theme } = options;

  // 验证 Mermaid 代码
  validateMermaidCode(code, type);

  if (output_format === "svg") {
    // 生成 SVG 包装
    const svgContent = generateMermaidSvg(code, theme);
    return {
      content: svgContent,
      format: "svg",
      type,
    };
  } else {
    // PNG 需要通过 mermaid.ink 服务渲染
    const pngUrl = generateMermaidInkUrl(code, theme, "png");
    const response = await fetch(pngUrl);

    if (!response.ok) {
      throw new Error(`Mermaid rendering failed: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    return {
      content: base64,
      format: "png",
      type,
    };
  }
}

/**
 * 验证 Mermaid 代码
 */
function validateMermaidCode(code: string, type: string): void {
  const typePatterns: Record<string, RegExp> = {
    flowchart: /^(graph|flowchart)\s+(TB|BT|LR|RL)/i,
    sequence: /^sequenceDiagram/i,
    class: /^classDiagram/i,
    state: /^stateDiagram/i,
    gantt: /^gantt/i,
    c4: /^C4Context|C4Container|C4Component/i,
  };

  const pattern = typePatterns[type];
  if (pattern && !pattern.test(code.trim())) {
    throw new Error(`Invalid ${type} diagram code. Expected to start with appropriate directive.`);
  }
}

/**
 * 生成带 Mermaid 代码的 SVG（用于客户端渲染）
 */
function generateMermaidSvg(code: string, theme: string): string {
  // 返回带 Mermaid 标记的 HTML，可用于客户端渲染
  const escapedCode = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return `<div class="mermaid" data-theme="${theme}">${escapedCode}</div>

<!-- 
  To render this Mermaid diagram, include mermaid.js:
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <script>mermaid.initialize({ theme: '${theme}' }); mermaid.run();</script>
-->

<!-- Raw Mermaid Code:
${code}
-->`;
}

/**
 * 生成 mermaid.ink 在线渲染 URL
 */
function generateMermaidInkUrl(code: string, theme: string, format: "png" | "svg"): string {
  const base64Code = Buffer.from(code).toString("base64");
  const themeParam = theme !== "default" ? `&theme=${theme}` : "";
  return `https://mermaid.ink/img/${base64Code}?type=${format}${themeParam}`;
}

/**
 * 生成 C4 架构图 Mermaid 代码
 */
export function generateC4Diagram(
  level: "context" | "container" | "component",
  entities: C4Entity[],
  relationships: C4Relationship[]
): string {
  const directive = {
    context: "C4Context",
    container: "C4Container",
    component: "C4Component",
  }[level];

  let code = `${directive}\n`;

  // 添加实体
  for (const entity of entities) {
    const entityType = getC4EntityType(entity.type);
    code += `  ${entityType}(${entity.id}, "${entity.name}", "${entity.description}")\n`;
  }

  code += "\n";

  // 添加关系
  for (const rel of relationships) {
    code += `  Rel(${rel.from}, ${rel.to}, "${rel.label}")\n`;
  }

  return code;
}

function getC4EntityType(type: string): string {
  const typeMap: Record<string, string> = {
    person: "Person",
    system: "System",
    system_ext: "System_Ext",
    container: "Container",
    container_ext: "Container_Ext",
    component: "Component",
  };
  return typeMap[type] || "System";
}

export interface C4Entity {
  id: string;
  name: string;
  description: string;
  type: string;
}

export interface C4Relationship {
  from: string;
  to: string;
  label: string;
}

/**
 * 验证渲染参数
 */
export function validateRenderOptions(input: RenderChartInput): MermaidRenderOptions {
  return {
    code: input.code,
    type: input.type || "flowchart",
    output_format: input.output_format || "svg",
    theme: input.theme || "default",
  };
}
