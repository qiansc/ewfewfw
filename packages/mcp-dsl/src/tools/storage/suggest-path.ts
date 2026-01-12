/**
 * c4a_local_suggest_path 工具实现
 * 根据 DSL type 和 id 自动生成正确的文件路径
 */

export interface SuggestPathInput {
  type: "system" | "container" | "component" | "adr" | "contract";
  id: string;
  status?: "draft" | "approved" | "published" | "archived";
  proposal_id?: string;
}

export interface SuggestPathResult {
  success: boolean;
  path: string;
  directory: string;
  filename: string;
  message: string;
}

/**
 * 类型到目录名的映射
 */
const TYPE_DIRECTORY_MAP: Record<string, string> = {
  container: "containers",
  component: "components",
  adr: "adr",
  "software-system": "systems",
  system: "systems",
  contract: "contracts",
};

/**
 * 根据 DSL type 和 id 生成推荐的文件路径
 */
export function suggestPathHandler(input: SuggestPathInput): SuggestPathResult {
  const { type, id, status = "draft", proposal_id } = input;

  // 获取目录名
  const dirName = TYPE_DIRECTORY_MAP[type];
  if (!dirName) {
    return {
      success: false,
      path: "",
      directory: "",
      filename: "",
      message: `未知的 DSL type: ${type}`,
    };
  }

  // 生成文件名
  const filename = `${id}.c4a.yaml`;

  // 根据状态和类型生成目录
  let directory: string;

  if (status === "draft") {
    if (proposal_id) {
      // 草稿：在提案目录下按类型组织
      // ADR 本身放在提案根目录，其他放在子目录
      if (type === "adr") {
        directory = `.c4a/drafts/${proposal_id}`;
      } else {
        directory = `.c4a/drafts/${proposal_id}/${dirName}`;
      }
    } else {
      // 没有提案 ID，直接放在 drafts 下
      directory = `.c4a/drafts/${dirName}`;
    }
  } else if (status === "approved") {
    if (proposal_id) {
      if (type === "adr") {
        directory = `.c4a/approved/${proposal_id}`;
      } else {
        directory = `.c4a/approved/${proposal_id}/${dirName}`;
      }
    } else {
      directory = `.c4a/approved/${dirName}`;
    }
  } else if (status === "published") {
    // 发布后按类型扁平组织
    if (type === "adr") {
      directory = `.c4a/published/adr`;
    } else {
      directory = `.c4a/published/${dirName.replace(/s$/, "")}`;
    }
  } else {
    // archived
    directory = `.c4a/archive/${dirName}`;
  }

  const path = `${directory}/${filename}`;

  return {
    success: true,
    path,
    directory,
    filename,
    message: `推荐路径: ${path}`,
  };
}
