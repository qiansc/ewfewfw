/**
 * c4a_local_transition_status 工具实现
 * 执行状态流转，包括修改状态字段和移动文件
 */
import { readFile, writeFile, mkdir, rename, rm, readdir } from "node:fs/promises";
import { join, dirname, basename, relative } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { TransitionInput } from "../../schemas/storageSchemas.js";
import { listHandler } from "./list.js";

export interface TransitionResult {
  success: boolean;
  old_status?: string;
  new_status?: string;
  old_path?: string;
  new_path?: string;
  message: string;
  moved_files?: string[];
}

// 状态流转规则
const TRANSITION_RULES: Record<string, string[]> = {
  draft: ["approved", "archived"],
  approved: ["published", "archived"],
  published: ["deprecated"],
  deprecated: ["archived"],
};

// 映射 dslType 到目录名（type: software-system 对应目录 system）
const TYPE_TO_DIR_NAME: Record<string, string> = {
  "software-system": "system",
  container: "container",
  component: "component",
  adr: "adr",
};

// 目标状态对应的目录
function getTargetDir(toStatus: string, dslType: string, proposalId?: string): string {
  // 使用映射表获取目录名
  const dirName = TYPE_TO_DIR_NAME[dslType] || dslType;
  switch (toStatus) {
    case "approved":
      return proposalId ? `approved/${proposalId}` : "approved";
    case "published":
      return `published/${dirName}`;
    case "deprecated":
      return `published/${dirName}`; // deprecated 保持在 published 下
    case "archived":
      return "archive";
    default:
      throw new Error(`未知目标状态: ${toStatus}`);
  }
}

// 从路径推断当前状态
function inferCurrentStatus(relativePath: string): string {
  if (relativePath.startsWith("drafts/")) return "draft";
  if (relativePath.startsWith("approved/")) return "approved";
  if (relativePath.startsWith("published/")) {
    // 需要读取内容才能判断是 published 还是 deprecated
    // 这里先返回 published，后面会根据 DSL 内容校正
    return "published";
  }
  if (relativePath.startsWith("archive/")) return "archived";
  throw new Error(`无法从路径推断状态: ${relativePath}`);
}

// 提取提案 ID
function extractProposalId(relativePath: string): string | undefined {
  const parts = relativePath.split("/");
  if ((parts[0] === "drafts" || parts[0] === "approved") && parts.length > 2) {
    return parts[1];
  }
  return undefined;
}

// 判断是否是提案目录下的主文件 (ADR)
function isProposalMainFile(relativePath: string): boolean {
  const parts = relativePath.split("/");
  // drafts/adr-001-xxx/adr-001.c4a.yaml 或 approved/adr-001-xxx/adr-001.c4a.yaml
  // 提案目录格式: adr-NNN-description，主文件格式: adr-NNN.c4a.yaml
  if ((parts[0] === "drafts" || parts[0] === "approved") && parts.length === 3) {
    const dirName = parts[1]; // e.g., "adr-001-v2-architecture"
    const fileName = parts[2]; // e.g., "adr-001.c4a.yaml"

    // 提取目录名中的 ADR ID (adr-NNN)
    const dirMatch = dirName.match(/^(adr-\d+)/);
    if (dirMatch) {
      const adrId = dirMatch[1]; // e.g., "adr-001"
      // 检查文件名是否以 ADR ID 开头
      return fileName.startsWith(adrId);
    }
  }
  return false;
}

// 获取提案目录下的所有文件
async function getProposalFiles(c4aRoot: string, proposalDir: string): Promise<string[]> {
  const files: string[] = [];

  async function scan(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.name.endsWith(".c4a.yaml")) {
          files.push(fullPath);
        }
      }
    } catch {
      // 目录不存在
    }
  }

  await scan(join(c4aRoot, proposalDir));
  return files;
}

// 更新 DSL 内容中的状态字段
function updateStatusInContent(
  content: Record<string, unknown>,
  toStatus: string,
  metadata?: TransitionInput["metadata"]
): Record<string, unknown> {
  const dslType = content.type as string;
  const updated = { ...content };

  // 根据类型更新对应的状态字段
  if (dslType === "adr" && updated.adr) {
    const adr = { ...(updated.adr as Record<string, unknown>) };
    adr.status = toStatus;
    if (metadata?.approved_by) {
      adr.approved_by = metadata.approved_by;
    }
    if (metadata?.reviewers) {
      adr.reviewers = metadata.reviewers;
    }
    updated.adr = adr;
  }

  // 注意：不添加 history 字段，因为：
  // 1. Schema 设置了 additionalProperties: false，不允许额外字段
  // 2. 状态流转历史可通过 Git 历史追踪
  // 3. 保持 DSL 文件简洁

  return updated;
}

export async function transitionHandler(
  input: TransitionInput
): Promise<TransitionResult> {
  const projectPath = input.project_path || ".";
  const c4aRoot = join(projectPath, ".c4a");
  const toStatus = input.to_status;

  // 确定源文件路径
  let sourcePath: string;
  let sourceRelative: string;

  if (input.path) {
    sourcePath = input.path.startsWith(".c4a/")
      ? join(projectPath, input.path)
      : join(projectPath, ".c4a", input.path);
    sourceRelative = input.path.startsWith(".c4a/")
      ? input.path.slice(5)
      : input.path;
  } else if (input.id && input.type) {
    const listResult = await listHandler({
      type: input.type,
      status: "all",
      project_path: projectPath,
    });
    const found = listResult.files.find((f) => f.id === input.id);
    if (!found) {
      return {
        success: false,
        message: `未找到 ${input.type} 类型的 DSL: ${input.id}`,
      };
    }
    sourcePath = join(projectPath, found.path);
    sourceRelative = found.path.slice(5); // 去掉 ".c4a/"
  } else {
    return {
      success: false,
      message: "必须提供 path 或 (id + type)",
    };
  }

  // 读取并解析源文件
  let content: Record<string, unknown>;
  try {
    const raw = await readFile(sourcePath, "utf-8");
    content = parseYaml(raw) as Record<string, unknown>;
  } catch (error) {
    return {
      success: false,
      message: `读取文件失败: ${(error as Error).message}`,
    };
  }

  const dslType = content.type as string;
  if (!dslType) {
    return {
      success: false,
      message: "DSL 文件缺少 type 字段",
    };
  }

  // 推断当前状态
  let currentStatus = inferCurrentStatus(sourceRelative);

  // 对于 published 目录下的文件，检查是否已经是 deprecated
  if (currentStatus === "published") {
    if (dslType === "adr") {
      const adr = content.adr as Record<string, unknown>;
      if (adr?.status === "deprecated") {
        currentStatus = "deprecated";
      }
    }
  }

  // 验证状态流转
  const allowedTransitions = TRANSITION_RULES[currentStatus];
  if (!allowedTransitions || !allowedTransitions.includes(toStatus)) {
    return {
      success: false,
      old_status: currentStatus,
      message: `不允许从 ${currentStatus} 流转到 ${toStatus}。允许的目标: ${allowedTransitions?.join(", ") || "无"}`,
    };
  }

  const proposalId = extractProposalId(sourceRelative);
  const isMainFile = isProposalMainFile(sourceRelative);
  const movedFiles: string[] = [];

  try {
    // 如果是提案主文件 (ADR)，需要移动整个提案目录
    if (isMainFile && proposalId) {
      const proposalDir = currentStatus === "draft" ? `drafts/${proposalId}` : `approved/${proposalId}`;
      const allFiles = await getProposalFiles(c4aRoot, proposalDir);

      if (toStatus === "published") {
        // 发布时：将文件按类型分散到 published/{type}/ 目录
        for (const filePath of allFiles) {
          const fileContent = parseYaml(await readFile(filePath, "utf-8")) as Record<string, unknown>;
          const fileType = fileContent.type as string;
          const targetDir = getTargetDir(toStatus, fileType);
          const fileName = basename(filePath);
          const targetPath = join(c4aRoot, targetDir, fileName);

          // 更新状态并写入
          const updatedContent = filePath === sourcePath
            ? updateStatusInContent(fileContent, toStatus, input.metadata)
            : fileContent;

          await mkdir(dirname(targetPath), { recursive: true });
          await writeFile(targetPath, stringifyYaml(updatedContent), "utf-8");

          movedFiles.push(`.c4a/${targetDir}/${fileName}`);
        }

        // 删除原提案目录
        await rm(join(c4aRoot, proposalDir), { recursive: true, force: true });
      } else if (toStatus === "approved" || toStatus === "archived") {
        // 批准或归档时：保持目录结构，整体移动到目标目录
        const targetProposalDir = toStatus === "approved"
          ? `approved/${proposalId}`
          : `archive/${proposalId}`;

        for (const filePath of allFiles) {
          // 计算相对于提案目录的路径，保持目录结构
          const relativeToProposal = relative(join(c4aRoot, proposalDir), filePath);
          const targetPath = join(c4aRoot, targetProposalDir, relativeToProposal);

          const fileContent = parseYaml(await readFile(filePath, "utf-8")) as Record<string, unknown>;

          // 只更新主文件的状态
          const updatedContent = filePath === sourcePath
            ? updateStatusInContent(fileContent, toStatus, input.metadata)
            : fileContent;

          await mkdir(dirname(targetPath), { recursive: true });
          await writeFile(targetPath, stringifyYaml(updatedContent), "utf-8");

          movedFiles.push(`.c4a/${targetProposalDir}/${relativeToProposal}`);
        }

        // 删除原提案目录
        await rm(join(c4aRoot, proposalDir), { recursive: true, force: true });
      }
    } else {
      // 单文件流转（非提案主文件）
      const targetDir = getTargetDir(toStatus, dslType, proposalId);
      const fileName = basename(sourcePath);
      const targetPath = join(c4aRoot, targetDir, fileName);

      // 更新状态
      const updatedContent = updateStatusInContent(content, toStatus, input.metadata);

      // 创建目标目录并写入
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, stringifyYaml(updatedContent), "utf-8");

      // 如果目标路径不同，删除源文件
      if (sourcePath !== targetPath) {
        await rm(sourcePath);
      }

      movedFiles.push(`.c4a/${targetDir}/${fileName}`);
    }

    const newPath = movedFiles.length === 1 ? movedFiles[0] : movedFiles[0];

    return {
      success: true,
      old_status: currentStatus,
      new_status: toStatus,
      old_path: `.c4a/${sourceRelative}`,
      new_path: newPath,
      moved_files: movedFiles.length > 1 ? movedFiles : undefined,
      message: `状态流转完成: ${currentStatus} → ${toStatus}`,
    };
  } catch (error) {
    return {
      success: false,
      old_status: currentStatus,
      message: `流转失败: ${(error as Error).message}`,
    };
  }
}
