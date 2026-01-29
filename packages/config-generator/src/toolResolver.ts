/**
 * 工具名称解析器
 *
 * 负责展开通配符工具名称（如 c4a_store_*）为显式列表
 */

/**
 * 静态工具列表（作为 fallback）
 * 实际使用时应查询 MCP Server 获取动态工具列表
 */
const KNOWN_TOOLS: Record<string, string[]> = {
  c4a_extract: [
    "c4a_extract_interfaces",
    "c4a_extract_analyze",
    "c4a_extract_ast",
    "c4a_extract_contract",
  ],
  c4a_store: [
    "c4a_store_save",
    "c4a_store_read",
    "c4a_store_list",
    "c4a_store_delete",
    "c4a_store_sync",
    "c4a_store_plan_sync",
    "c4a_store_feat_lifecycle",
    "c4a_store_feat_merge",
    "c4a_store_feat_checklist",
    "c4a_store_update_workflow_step",
    "c4a_store_read_history",
    "c4a_store_backup",
    "c4a_store_restore",
    "c4a_store_repair",
    "c4a_store_validate",
  ],
  c4a_query: [
    "c4a_query_search",
    "c4a_query_deps",
    "c4a_query_impact",
  ],
  c4a_visual: [
    "c4a_visual_generate",
    "c4a_visual_render",
    "c4a_visual_list_templates",
    "c4a_visual_render_template",
    "c4a_visual_save",
    "c4a_visual_get_reference",
    "c4a_visual_render_c4",
    "c4a_visual_cleanup",
    "c4a_visual_storage_stats",
    "c4a_visual_get_style",
  ],
};

/**
 * 工具名称前缀到 MCP 服务器名称的映射
 *
 * Claude Code 中 MCP 工具的完整格式是 mcp__<server-name>__<tool-name>
 */
const TOOL_PREFIX_TO_SERVER: Record<string, string> = {
  c4a_extract: "c4a-extract-mcp",
  c4a_store: "c4a-store-mcp",
  c4a_query: "c4a-query-mcp",
  c4a_visual: "c4a-visual-mcp",
};

/**
 * 根据工具名称获取所属的 MCP 服务器名称
 */
function getServerName(toolName: string): string | null {
  for (const [prefix, serverName] of Object.entries(TOOL_PREFIX_TO_SERVER)) {
    if (toolName.startsWith(prefix)) {
      return serverName;
    }
  }
  return null;
}

/**
 * 展开通配符工具名称
 *
 * @param patterns 工具模式列表（支持通配符）
 * @returns 展开后的工具名称列表
 */
export function expandToolPatterns(patterns: string[]): string[] {
  const expanded = new Set<string>();

  for (const pattern of patterns) {
    if (pattern.endsWith("*")) {
      // 通配符模式
      const prefix = pattern.slice(0, -1); // 移除 *
      const basePrefix = prefix.replace(/_$/, ""); // 移除尾部 _

      // 查找匹配的工具组
      const tools = KNOWN_TOOLS[basePrefix];
      if (tools) {
        tools.forEach((tool) => expanded.add(tool));
      } else {
        // 如果没有找到预定义工具组，保留原模式
        expanded.add(pattern);
      }
    } else {
      // 精确匹配
      expanded.add(pattern);
    }
  }

  return Array.from(expanded).sort();
}

/**
 * 将工具名称转换为 Claude SDK 格式
 *
 * Claude SDK 要求：
 * - 系统工具名称首字母必须大写（Read, Edit, Bash 等）
 * - MCP 工具名称格式为 mcp__<server-name>__<tool-name>
 */
export function toClaudeSdkToolName(toolName: string): string {
  // 已经是 mcp__ 前缀的不处理
  if (toolName.startsWith("mcp__")) {
    return toolName;
  }

  // 系统工具映射（支持大小写输入，输出首字母大写）
  const systemToolsMap: Record<string, string> = {
    read: "Read",
    edit: "Edit",
    bash: "Bash",
    glob: "Glob",
    grep: "Grep",
    todowrite: "TodoWrite",
    websearch: "WebSearch",
    webfetch: "WebFetch",
  };

  const lowerName = toolName.toLowerCase();
  if (systemToolsMap[lowerName]) {
    return systemToolsMap[lowerName];
  }

  // C4A MCP 工具：添加完整的 mcp__<server>__<tool> 格式
  if (toolName.startsWith("c4a_")) {
    const serverName = getServerName(toolName);
    if (serverName) {
      return `mcp__${serverName}__${toolName}`;
    }
    // fallback: 如果找不到服务器映射，使用旧格式（不应该发生）
    return `mcp__${toolName}`;
  }

  return toolName;
}

/**
 * 批量转换工具名称为 Claude SDK 格式
 */
export function toClaudeSdkToolNames(toolNames: string[]): string[] {
  return toolNames.map(toClaudeSdkToolName);
}

/**
 * 合并 allowedTools 和 deniedTools
 *
 * @returns { allow: string[], deny: string[] }
 */
export function mergeToolPermissions(
  allowedTools: string[],
  deniedTools: string[] = []
): { allow: string[]; deny: string[] } {
  return {
    allow: expandToolPatterns(allowedTools),
    deny: expandToolPatterns(deniedTools),
  };
}
