/**
 * 存储管理工具
 */
import type {
  SaveImageInput,
  GetReferenceInput,
} from "../schemas/inputSchemas.js";
import type {
  SaveImageResult,
  GetReferenceResult,
} from "../types/index.js";
import {
  saveImage,
  getReference,
} from "../storage/storage-manager.js";

export async function saveImageHandler(
  input: SaveImageInput
): Promise<SaveImageResult> {
  return saveImage(
    input.data,
    input.format,
    input.storage_mode,
    {
      reportId: input.report_id,
      filename: input.filename,
      metadata: input.metadata as Record<string, unknown>,
    }
  );
}

export async function getReferenceHandler(
  input: GetReferenceInput
): Promise<GetReferenceResult> {
  return getReference(input.image_id, input.reference_type || "relative", {
    basePath: input.base_path,
    altText: input.alt_text,
  });
}
