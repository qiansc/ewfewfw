/**
 * 图片生成工具
 */
import type { GenerateImageInput } from "../schemas/inputSchemas.js";
import type { GenerateImageResult } from "../types/index.js";
import { generateWithGemini, validateGenerateOptions } from "../renderers/gemini.js";
import { renderTemplate } from "../templates/template-manager.js";
import { saveImage } from "../storage/storage-manager.js";

export async function generateImageHandler(
  input: GenerateImageInput
): Promise<GenerateImageResult> {
  let prompt = input.prompt;

  // 如果指定了模板，先渲染模板
  if (input.template_id) {
    const templateResult = await renderTemplate(
      input.template_id,
      input.template_variables || {}
    );
    prompt = templateResult.rendered;
  }

  if (!prompt) {
    throw new Error("No prompt provided and template rendering failed");
  }

  // 验证并准备生成参数
  const options = validateGenerateOptions({
    ...input,
    prompt,
  });

  // 调用 Gemini API 生成图片
  const { buffer, metadata } = await generateWithGemini(options);

  // 保存图片
  const saveResult = await saveImage(buffer, input.format || "PNG", input.storage_mode || "cache", {
    reportId: input.report_id,
    filename: input.filename,
    metadata: {
      prompt,
      template_id: input.template_id,
      ...metadata,
    },
  });

  return {
    success: true,
    image_id: saveResult.image_id,
    path: saveResult.path,
    format: input.format || "PNG",
    size: input.size || "2K",
    aspect_ratio: input.aspect_ratio || "16:9",
    storage_mode: saveResult.storage_mode,
    metadata: {
      ...metadata,
      template_id: input.template_id,
    },
  };
}
