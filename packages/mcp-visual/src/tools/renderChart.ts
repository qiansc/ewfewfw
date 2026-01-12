/**
 * 图表渲染工具
 */
import type { RenderChartInput } from "../schemas/inputSchemas.js";
import type { RenderChartResult } from "../types/index.js";
import { renderMermaid, validateRenderOptions } from "../renderers/mermaid.js";
import { saveImage } from "../storage/storage-manager.js";

export async function renderChartHandler(
  input: RenderChartInput
): Promise<RenderChartResult> {
  // 验证并准备渲染参数
  const options = validateRenderOptions(input);

  // 渲染 Mermaid 图表
  const renderResult = await renderMermaid(options);

  // 确定存储格式
  const format = renderResult.format.toUpperCase() as "SVG" | "PNG";

  // 保存图表
  const saveResult = await saveImage(
    renderResult.format === "svg"
      ? Buffer.from(renderResult.content, "utf-8")
      : Buffer.from(renderResult.content, "base64"),
    format,
    input.storage_mode || "cache",
    {
      reportId: input.report_id,
      filename: input.filename,
      metadata: {
        type: input.type,
        theme: input.theme,
        mermaid_code: input.code,
      },
    }
  );

  return {
    success: true,
    image_id: saveResult.image_id,
    path: saveResult.path,
    format: renderResult.format,
    type: renderResult.type,
    storage_mode: saveResult.storage_mode,
  };
}
