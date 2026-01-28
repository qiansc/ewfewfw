/**
 * proposal_id 上下文管理 - CoW 防护机制
 *
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-feat-lifecycle.md §3.7.3
 *
 * 防护机制：
 * 1. Skill 层注入 - 启动 feat 相关 Skill 时注入 proposal_id
 * 2. CLI Session 上下文 - CLI 维护当前 feat，自动填充
 * 3. Server 端校验 - 检测可疑的无 proposal_id 写入
 */

// ============================================================
// 类型定义
// ============================================================

/**
 * Feat Session 状态
 */
export interface FeatSessionState {
  /** 当前 feat ID */
  currentFeatId: string | null;
  /** 进入 feat 的时间 */
  enteredAt: string | null;
  /** 是否自动填充 proposal_id */
  autoFillProposalId: boolean;
}

/**
 * 写入校验结果
 */
export interface WriteValidationResult {
  valid: boolean;
  error?: "MISSING_PROPOSAL_ID" | "PROPOSAL_ID_MISMATCH";
  message?: string;
  suggestion?: string;
}

/**
 * Store 写入工具名称
 */
export type StoreWriteTool =
  | "c4a_store_save"
  | "c4a_store_delete"
  | "c4a_store_sync"
  | "c4a_store_feat_lifecycle"
  | "c4a_store_feat_merge";

// ============================================================
// 常量
// ============================================================

/**
 * 需要 proposal_id 的写入工具列表
 */
export const STORE_WRITE_TOOLS: StoreWriteTool[] = [
  "c4a_store_save",
  "c4a_store_delete",
  "c4a_store_sync",
  "c4a_store_feat_lifecycle",
  "c4a_store_feat_merge",
];

// ============================================================
// FeatSession 类
// ============================================================

/**
 * Feat Session 上下文管理
 *
 * CLI 层使用，维护当前 feat 上下文，自动填充 proposal_id
 */
export class FeatSession {
  private state: FeatSessionState = {
    currentFeatId: null,
    enteredAt: null,
    autoFillProposalId: true,
  };

  /**
   * 进入 feat 上下文
   */
  enterFeat(featId: string): void {
    this.state.currentFeatId = featId;
    this.state.enteredAt = new Date().toISOString();
  }

  /**
   * 退出 feat 上下文
   */
  exitFeat(): void {
    this.state.currentFeatId = null;
    this.state.enteredAt = null;
  }

  /**
   * 获取当前 feat ID
   */
  getCurrentFeatId(): string | null {
    return this.state.currentFeatId;
  }

  /**
   * 检查是否在 feat 上下文中
   */
  isInFeat(): boolean {
    return this.state.currentFeatId !== null;
  }

  /**
   * 获取 session 状态
   */
  getState(): Readonly<FeatSessionState> {
    return { ...this.state };
  }

  /**
   * 设置是否自动填充 proposal_id
   */
  setAutoFillProposalId(enabled: boolean): void {
    this.state.autoFillProposalId = enabled;
  }

  /**
   * 检查工具是否是写入工具
   */
  isStoreWriteTool(toolName: string): boolean {
    return STORE_WRITE_TOOLS.includes(toolName as StoreWriteTool);
  }

  /**
   * 包装 MCP 调用参数，自动填充 proposal_id
   */
  wrapMcpCallParams<T extends Record<string, unknown>>(
    toolName: string,
    params: T
  ): T {
    if (
      this.state.autoFillProposalId &&
      this.state.currentFeatId &&
      this.isStoreWriteTool(toolName)
    ) {
      // 如果参数中没有 proposal_id，自动填充
      if (params.proposal_id === undefined || params.proposal_id === null) {
        return {
          ...params,
          proposal_id: this.state.currentFeatId,
        };
      }
    }
    return params;
  }
}

// ============================================================
// Skill 上下文注入
// ============================================================

/**
 * 生成 Skill 上下文提示
 *
 * 用于在启动 feat 相关 Skill 时注入上下文
 */
export function generateSkillContext(featId: string): string {
  return `
当前正在 feat "${featId}" 中工作。
所有 c4a_store_* 调用必须携带 proposal_id: "${featId}"
`.trim();
}

/**
 * 生成 Skill 上下文提示（详细版）
 */
export function generateDetailedSkillContext(
  featId: string,
  featTitle?: string
): string {
  const title = featTitle ? ` (${featTitle})` : "";
  return `
## Feat 上下文

当前正在 feat "${featId}"${title} 中工作。

### 重要提醒

1. **所有写入操作必须携带 proposal_id**
   - c4a_store_save: proposal_id="${featId}"
   - c4a_store_delete: proposal_id="${featId}"

2. **不要直接修改主分支**
   - 除非明确需要，否则不要使用 proposal_id=null
   - 如果需要修改主分支，请先确认用户意图

3. **发布前请确认**
   - 使用 c4a_store_feat_lifecycle 发布前，确保所有修改已同步
`.trim();
}

// ============================================================
// Server 端校验
// ============================================================

/**
 * 校验写入操作的 proposal_id
 *
 * Server 端使用，检测可疑的无 proposal_id 写入
 *
 * @param entityId - 实体 ID
 * @param proposalId - 请求中的 proposal_id
 * @param entityExists - 实体是否已存在
 * @param forceMainBranch - 是否强制写入主分支
 */
export function validateWriteProposalId(
  entityId: string,
  proposalId: string | null | undefined,
  entityExists: boolean,
  forceMainBranch = false
): WriteValidationResult {
  // 如果强制写入主分支，跳过校验
  if (forceMainBranch) {
    return { valid: true };
  }

  // 如果实体已存在但没有指定 proposal_id，这是可疑的
  if (!proposalId && entityExists) {
    return {
      valid: false,
      error: "MISSING_PROPOSAL_ID",
      message: `修改已存在的实体 "${entityId}" 需要指定 proposal_id`,
      suggestion: "请指定 proposal_id，或使用 force_main_branch=true 强制写入主分支",
    };
  }

  return { valid: true };
}

/**
 * 校验 proposal_id 是否与当前上下文匹配
 */
export function validateProposalIdMatch(
  requestProposalId: string | null | undefined,
  expectedProposalId: string | null
): WriteValidationResult {
  // 如果没有期望的 proposal_id，不校验
  if (!expectedProposalId) {
    return { valid: true };
  }

  // 如果请求中的 proposal_id 与期望不匹配
  if (requestProposalId && requestProposalId !== expectedProposalId) {
    return {
      valid: false,
      error: "PROPOSAL_ID_MISMATCH",
      message: `请求的 proposal_id "${requestProposalId}" 与当前上下文 "${expectedProposalId}" 不匹配`,
      suggestion: `请使用 proposal_id="${expectedProposalId}" 或退出当前 feat 上下文`,
    };
  }

  return { valid: true };
}

// ============================================================
// 单例实例
// ============================================================

/**
 * 全局 FeatSession 实例
 */
let globalFeatSession: FeatSession | null = null;

/**
 * 获取全局 FeatSession 实例
 */
export function getFeatSession(): FeatSession {
  if (!globalFeatSession) {
    globalFeatSession = new FeatSession();
  }
  return globalFeatSession;
}

/**
 * 重置全局 FeatSession（用于测试）
 */
export function resetFeatSession(): void {
  globalFeatSession = null;
}
