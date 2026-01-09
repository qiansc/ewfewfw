/**
 * c4a_local_list_files 工具实现
 * 列出 .c4a/ 目录下的 DSL 文件
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, basename, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ListInput } from "../../schemas/storageSchemas.js";

export interface FileInfo {
  path: string;
  type: string;
  status: string;
  id: string;
  name: string;
  proposal_id?: string;
}

export interface ListResult {
  files: FileInfo[];
}

// 状态到目录映射
const STATUS_DIRS: Record<string, string[]> = {
  draft: ["drafts"],
  approved: ["approved"],
  published: ["published/system", "published/container", "published/component", "published/adr"],
  archived: ["archive"],
  all: ["drafts", "approved", "published/system", "published/container", "published/component", "published/adr", "archive"],
};

// 从路径推断状态
function inferStatusFromPath(relativePath: string): string {
  if (relativePath.startsWith("drafts/")) return "draft";
  if (relativePath.startsWith("approved/")) return "approved";
  if (relativePath.startsWith("published/")) return "published";
  if (relativePath.startsWith("archive/")) return "archived";
  return "unknown";
}

// 从路径推断类型
function inferTypeFromPath(relativePath: string): string {
  // 目录名使用 system，但返回 DSL 的 type 值 software-system
  if (relativePath.includes("/system/") || relativePath.startsWith("published/system")) return "software-system";
  if (relativePath.includes("/container/") || relativePath.startsWith("published/container")) return "container";
  if (relativePath.includes("/component/") || relativePath.startsWith("published/component")) return "component";
  if (relativePath.includes("/adr/") || relativePath.startsWith("published/adr")) return "adr";
  return "unknown";
}

// 映射 type 到数据键名（type: software-system 的数据在 system: 下）
const TYPE_TO_DATA_KEY: Record<string, string> = {
  "software-system": "system",
  "container": "container",
  "component": "component",
  "adr": "adr",
};

// 从 DSL 内容提取 ID 和名称
function extractDSLInfo(content: Record<string, unknown>): { id: string; name: string; type: string } | null {
  const dslType = content.type as string;
  if (!dslType) return null;

  // 获取数据键（software-system → system）
  const dataKey = TYPE_TO_DATA_KEY[dslType] || dslType;

  let info: { id: string; name: string } | undefined;

  if (dataKey === "system" && content.system) {
    const system = content.system as Record<string, unknown>;
    info = { id: system.id as string, name: system.name as string };
  } else if (dataKey === "container" && content.container) {
    const container = content.container as Record<string, unknown>;
    info = { id: container.id as string, name: container.name as string };
  } else if (dataKey === "component" && content.component) {
    const component = content.component as Record<string, unknown>;
    info = { id: component.id as string, name: component.name as string };
  } else if (dataKey === "adr" && content.adr) {
    const adr = content.adr as Record<string, unknown>;
    info = { id: adr.id as string, name: adr.title as string };
  }

  if (info) {
    // 返回原始 dslType（如 software-system），与目录名一致
    return { ...info, type: dslType };
  }
  return null;
}

// 从路径提取提案 ID
function extractProposalId(relativePath: string): string | undefined {
  // 格式: drafts/<proposal-id>/... 或 approved/<proposal-id>/...
  const parts = relativePath.split("/");
  if ((parts[0] === "drafts" || parts[0] === "approved") && parts.length > 2) {
    return parts[1];
  }
  return undefined;
}

// 递归扫描目录查找 .c4a.yaml 文件
async function scanDirectory(dir: string, c4aRoot: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const subFiles = await scanDirectory(fullPath, c4aRoot);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith(".c4a.yaml")) {
        files.push(fullPath);
      }
    }
  } catch {
    // 目录不存在，忽略
  }

  return files;
}

export async function listHandler(input: ListInput): Promise<ListResult> {
  const projectPath = input.project_path || ".";
  const c4aRoot = join(projectPath, ".c4a");
  const statusFilter = input.status || "all";
  const typeFilter = input.type || "all";

  const result: FileInfo[] = [];
  const dirsToScan = STATUS_DIRS[statusFilter] || STATUS_DIRS.all;

  for (const dir of dirsToScan) {
    const fullDir = join(c4aRoot, dir);
    const files = await scanDirectory(fullDir, c4aRoot);

    for (const filePath of files) {
      try {
        const content = await readFile(filePath, "utf-8");
        const parsed = parseYaml(content) as Record<string, unknown>;
        const dslInfo = extractDSLInfo(parsed);

        if (!dslInfo) continue;

        // 类型过滤
        if (typeFilter !== "all" && dslInfo.type !== typeFilter) continue;

        const relativePath = relative(c4aRoot, filePath);
        const status = inferStatusFromPath(relativePath);
        const proposalId = extractProposalId(relativePath);

        result.push({
          path: `.c4a/${relativePath}`,
          type: dslInfo.type,
          status,
          id: dslInfo.id,
          name: dslInfo.name,
          ...(proposalId && { proposal_id: proposalId }),
        });
      } catch {
        // 解析失败，跳过
      }
    }
  }

  return { files: result };
}
