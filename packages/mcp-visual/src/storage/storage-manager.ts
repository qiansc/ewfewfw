/**
 * 图片存储管理器
 *
 * 支持 cache/permanent/report 三种存储模式
 */
import { mkdir, writeFile, readFile, unlink, readdir, stat } from "fs/promises";
import { join, resolve, relative, dirname, basename, extname } from "path";
import { existsSync } from "fs";
import { config } from "../config.js";
import type {
  StorageMode,
  ReferenceType,
  StoredImage,
  SaveImageResult,
  GetReferenceResult,
} from "../types/index.js";

// 存储路径映射
const STORAGE_PATHS: Record<StorageMode, string> = {
  cache: "cache/visual/temp",
  permanent: "assets/images",
  report: "reports",
};

// 元数据存储
const metadataStore = new Map<string, StoredImage>();

/**
 * 获取存储基础路径
 */
function getBasePath(): string {
  return resolve(process.cwd(), config.storage_base_path);
}

/**
 * 生成唯一图片 ID
 */
function generateImageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `img-${timestamp}-${random}`;
}

/**
 * 获取存储路径
 */
function getStoragePath(
  mode: StorageMode,
  reportId?: string
): string {
  const basePath = getBasePath();

  if (mode === "report") {
    if (!reportId) {
      throw new Error("report_id is required for report storage mode");
    }
    return join(basePath, "reports", reportId, "images");
  }

  return join(basePath, STORAGE_PATHS[mode]);
}

/**
 * 保存图片
 */
export async function saveImage(
  data: Buffer | string,
  format: string,
  mode: StorageMode,
  options: {
    reportId?: string;
    filename?: string;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<SaveImageResult> {
  const imageId = generateImageId();
  const ext = format.toLowerCase() === "jpeg" ? "jpg" : format.toLowerCase();
  const filename = options.filename || `${imageId}.${ext}`;

  const storagePath = getStoragePath(mode, options.reportId);

  // 确保目录存在
  await mkdir(storagePath, { recursive: true });

  const filePath = join(storagePath, filename);

  // 写入文件
  const buffer = typeof data === "string" ? Buffer.from(data, "base64") : data;
  await writeFile(filePath, buffer);

  // 存储元数据
  const storedImage: StoredImage = {
    id: imageId,
    path: filePath,
    format: ext,
    storage_mode: mode,
    created_at: new Date().toISOString(),
    metadata: options.metadata || {},
  };

  metadataStore.set(imageId, storedImage);

  // 同时保存元数据到 JSON 文件
  const metadataPath = `${filePath}.meta.json`;
  await writeFile(metadataPath, JSON.stringify(storedImage, null, 2));

  return {
    success: true,
    image_id: imageId,
    path: filePath,
    storage_mode: mode,
  };
}

/**
 * 获取图片引用
 */
export async function getReference(
  imageId: string,
  referenceType: ReferenceType,
  options: {
    basePath?: string;
    altText?: string;
    baseUrl?: string;
  } = {}
): Promise<GetReferenceResult> {
  // 从缓存或磁盘获取元数据
  let storedImage = metadataStore.get(imageId);

  if (!storedImage) {
    // 尝试从元数据文件加载
    storedImage = await findImageById(imageId);
    if (storedImage) {
      metadataStore.set(imageId, storedImage);
    }
  }

  if (!storedImage) {
    throw new Error(`Image not found: ${imageId}`);
  }

  let reference: string;

  switch (referenceType) {
    case "absolute":
      reference = resolve(storedImage.path);
      break;

    case "relative":
      const base = options.basePath || process.cwd();
      reference = relative(base, storedImage.path);
      break;

    case "url":
      const baseUrl = options.baseUrl || "http://localhost:3000/images";
      const filename = basename(storedImage.path);
      reference = `${baseUrl}/${filename}`;
      break;

    case "markdown":
      const alt = options.altText || "Image";
      const relativePath = relative(options.basePath || process.cwd(), storedImage.path);
      reference = `![${alt}](${relativePath})`;
      break;

    default:
      reference = storedImage.path;
  }

  return {
    success: true,
    reference,
    reference_type: referenceType,
    image_id: imageId,
  };
}

/**
 * 根据 ID 查找图片
 */
async function findImageById(imageId: string): Promise<StoredImage | null> {
  const basePath = getBasePath();
  const searchPaths = [
    join(basePath, STORAGE_PATHS.cache),
    join(basePath, STORAGE_PATHS.permanent),
    join(basePath, "reports"),
  ];

  for (const searchPath of searchPaths) {
    if (!existsSync(searchPath)) continue;

    const found = await searchInDirectory(searchPath, imageId);
    if (found) return found;
  }

  return null;
}

/**
 * 在目录中搜索图片元数据
 */
async function searchInDirectory(
  dir: string,
  imageId: string
): Promise<StoredImage | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const found = await searchInDirectory(entryPath, imageId);
        if (found) return found;
      } else if (entry.name.endsWith(".meta.json")) {
        try {
          const content = await readFile(entryPath, "utf-8");
          const metadata = JSON.parse(content) as StoredImage;
          if (metadata.id === imageId) {
            return metadata;
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  } catch {
    // 忽略目录访问错误
  }

  return null;
}

/**
 * 清理临时缓存文件
 */
export async function cleanupTempFiles(olderThanHours: number = 24): Promise<{
  deleted: number;
  errors: string[];
}> {
  const cachePath = getStoragePath("cache");
  const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;

  let deleted = 0;
  const errors: string[] = [];

  if (!existsSync(cachePath)) {
    return { deleted, errors };
  }

  try {
    const files = await readdir(cachePath);

    for (const file of files) {
      const filePath = join(cachePath, file);

      try {
        const stats = await stat(filePath);
        if (stats.mtimeMs < cutoff) {
          await unlink(filePath);
          deleted++;

          // 同时删除元数据文件
          const metaPath = `${filePath}.meta.json`;
          if (existsSync(metaPath)) {
            await unlink(metaPath);
          }
        }
      } catch (err) {
        errors.push(`Failed to process ${file}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    errors.push(`Failed to read cache directory: ${(err as Error).message}`);
  }

  return { deleted, errors };
}

/**
 * 获取存储统计
 */
export async function getStorageStats(): Promise<{
  cache: { count: number; size: number };
  permanent: { count: number; size: number };
  report: { count: number; size: number };
}> {
  const stats = {
    cache: { count: 0, size: 0 },
    permanent: { count: 0, size: 0 },
    report: { count: 0, size: 0 },
  };

  for (const mode of ["cache", "permanent", "report"] as StorageMode[]) {
    const path = getStoragePath(mode);
    if (!existsSync(path)) continue;

    try {
      const dirStats = await getDirectoryStats(path);
      stats[mode] = dirStats;
    } catch {
      // 忽略错误
    }
  }

  return stats;
}

/**
 * 获取目录统计
 */
async function getDirectoryStats(
  dir: string
): Promise<{ count: number; size: number }> {
  let count = 0;
  let size = 0;

  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const subStats = await getDirectoryStats(entryPath);
      count += subStats.count;
      size += subStats.size;
    } else if (!entry.name.endsWith(".meta.json")) {
      count++;
      const stats = await stat(entryPath);
      size += stats.size;
    }
  }

  return { count, size };
}
