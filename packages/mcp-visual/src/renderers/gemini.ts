/**
 * Gemini 3 Pro Image 渲染器
 *
 * 使用 Google Gemini API 生成高质量图片
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config.js";
import type { GenerateImageInput } from "../schemas/inputSchemas.js";
import type { ImageMetadata } from "../types/index.js";

// 分辨率映射
const SIZE_MAP = {
  "1K": { width: 1024, height: 1024 },
  "2K": { width: 2048, height: 2048 },
  "4K": { width: 4096, height: 4096 },
};

// 宽高比映射
const ASPECT_RATIO_MAP = {
  "1:1": { width: 1, height: 1 },
  "16:9": { width: 16, height: 9 },
  "9:16": { width: 9, height: 16 },
  "4:3": { width: 4, height: 3 },
  "3:4": { width: 3, height: 4 },
};

export interface GeminiGenerateOptions {
  prompt: string;
  size: "1K" | "2K" | "4K";
  aspect_ratio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  format: "PNG" | "JPEG";
}

export interface GeminiGenerateResult {
  buffer: Buffer;
  metadata: ImageMetadata;
}

/**
 * 使用 Gemini API 生成图片
 */
export async function generateWithGemini(
  options: GeminiGenerateOptions
): Promise<GeminiGenerateResult> {
  if (!config.gemini_api_key) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const genAI = new GoogleGenerativeAI(config.gemini_api_key);

  // 使用 Gemini 3 Pro Image Preview 模型
  const model = genAI.getGenerativeModel({
    model: "gemini-3-pro-image-preview",
    generationConfig: {
      responseModalities: ["Text", "Image"],
    } as never,
  });

  const baseSize = SIZE_MAP[options.size];
  const ratio = ASPECT_RATIO_MAP[options.aspect_ratio];

  // 计算实际尺寸
  let width: number, height: number;
  if (ratio.width > ratio.height) {
    width = baseSize.width;
    height = Math.round((baseSize.width * ratio.height) / ratio.width);
  } else {
    height = baseSize.height;
    width = Math.round((baseSize.height * ratio.width) / ratio.height);
  }

  // 构建提示词
  const enhancedPrompt = `${options.prompt}

Style: Professional, clean, modern design suitable for technical documentation.
Resolution: ${width}x${height} pixels
Format: ${options.format}`;

  try {
    const result = await model.generateContent(enhancedPrompt);
    const response = result.response;

    // 提取图片数据
    const parts = response.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((part: { inlineData?: unknown }) => part.inlineData);

    if (!imagePart || !("inlineData" in imagePart)) {
      throw new Error("No image generated in response");
    }

    const imageData = imagePart.inlineData as { data: string; mimeType: string };
    const buffer = Buffer.from(imageData.data, "base64");

    const metadata: ImageMetadata = {
      prompt: options.prompt,
      model: "gemini-3-pro-image-preview",
      generated_at: new Date().toISOString(),
      file_size: buffer.length,
      dimensions: { width, height },
    };

    return { buffer, metadata };
  } catch (error) {
    const err = error as Error;
    if (err.message.includes("quota")) {
      throw new Error("Gemini API quota exceeded. Please try again later.");
    }
    if (err.message.includes("API key")) {
      throw new Error("Invalid Gemini API key.");
    }
    throw new Error(`Gemini API error: ${err.message}`);
  }
}

/**
 * 验证生成参数
 */
export function validateGenerateOptions(input: GenerateImageInput): GeminiGenerateOptions {
  if (!input.prompt && !input.template_id) {
    throw new Error("Either prompt or template_id must be provided");
  }

  return {
    prompt: input.prompt,
    size: input.size || "2K",
    aspect_ratio: input.aspect_ratio || "16:9",
    format: input.format || "PNG",
  };
}
