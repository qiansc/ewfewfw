/**
 * 数据完整性检查模块
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/appendix.md §A.9.3
 *
 * 提供 Local 模式数据完整性检查：
 * - 检查 source_project 字段
 * - 检查 source_repo 字段
 * - 检查字段格式
 * - 检查层级字段
 */

import type { SQLQueryBindings } from 'bun:sqlite';
import { SQLiteStore } from './sqlite-store.js';
import type { EntityType, EntityStatus } from './adapter.js';
import { ERROR_MESSAGES, MIGRATE_ERROR_CODES as MIGRATE_ERROR_CODE_MAP } from '@c4a/core/types';

// ============================================================
// 错误码定义
// ============================================================

/**
 * 迁移错误码
 *
 * 设计文档: appendix.md §A.9.7
 */
export const MIGRATE_ERROR_CODES = {
  [MIGRATE_ERROR_CODE_MAP.MISSING_SOURCE_PROJECT]: {
    code: MIGRATE_ERROR_CODE_MAP.MISSING_SOURCE_PROJECT,
    message: ERROR_MESSAGES[MIGRATE_ERROR_CODE_MAP.MISSING_SOURCE_PROJECT].zh,
    fix: '使用 repair 自动补全',
    autoFix: true,
  },
  [MIGRATE_ERROR_CODE_MAP.MISSING_SOURCE_REPO]: {
    code: MIGRATE_ERROR_CODE_MAP.MISSING_SOURCE_REPO,
    message: ERROR_MESSAGES[MIGRATE_ERROR_CODE_MAP.MISSING_SOURCE_REPO].zh,
    fix: '使用 repair 自动补全',
    autoFix: true,
  },
  [MIGRATE_ERROR_CODE_MAP.INVALID_SOURCE_PROJECT_FORMAT]: {
    code: MIGRATE_ERROR_CODE_MAP.INVALID_SOURCE_PROJECT_FORMAT,
    message: ERROR_MESSAGES[MIGRATE_ERROR_CODE_MAP.INVALID_SOURCE_PROJECT_FORMAT].zh,
    fix: '使用 repair 自动修复格式',
    autoFix: true,
  },
  [MIGRATE_ERROR_CODE_MAP.SOURCE_REPO_FORMAT_SUGGESTION]: {
    code: MIGRATE_ERROR_CODE_MAP.SOURCE_REPO_FORMAT_SUGGESTION,
    message: ERROR_MESSAGES[MIGRATE_ERROR_CODE_MAP.SOURCE_REPO_FORMAT_SUGGESTION].zh,
    fix: '手动修改为 owner/repo 格式',
    autoFix: false,
  },
  [MIGRATE_ERROR_CODE_MAP.NON_PROJECT_SCOPE_HAS_SOURCE_PROJECT]: {
    code: MIGRATE_ERROR_CODE_MAP.NON_PROJECT_SCOPE_HAS_SOURCE_PROJECT,
    message: ERROR_MESSAGES[MIGRATE_ERROR_CODE_MAP.NON_PROJECT_SCOPE_HAS_SOURCE_PROJECT].zh,
    fix: '使用 repair 自动移除',
    autoFix: true,
  },
  [MIGRATE_ERROR_CODE_MAP.NON_PROJECT_SCOPE_HAS_SOURCE_REPO]: {
    code: MIGRATE_ERROR_CODE_MAP.NON_PROJECT_SCOPE_HAS_SOURCE_REPO,
    message: ERROR_MESSAGES[MIGRATE_ERROR_CODE_MAP.NON_PROJECT_SCOPE_HAS_SOURCE_REPO].zh,
    fix: '使用 repair 自动移除',
    autoFix: true,
  },
  [MIGRATE_ERROR_CODE_MAP.EXTERNAL_ENTITY_HAS_SOURCE_PROJECT]: {
    code: MIGRATE_ERROR_CODE_MAP.EXTERNAL_ENTITY_HAS_SOURCE_PROJECT,
    message: ERROR_MESSAGES[MIGRATE_ERROR_CODE_MAP.EXTERNAL_ENTITY_HAS_SOURCE_PROJECT].zh,
    fix: '使用 repair 自动移除',
    autoFix: true,
  },
  [MIGRATE_ERROR_CODE_MAP.EXTERNAL_ENTITY_MISSING_URL]: {
    code: MIGRATE_ERROR_CODE_MAP.EXTERNAL_ENTITY_MISSING_URL,
    message: ERROR_MESSAGES[MIGRATE_ERROR_CODE_MAP.EXTERNAL_ENTITY_MISSING_URL].zh,
    fix: '手动添加外部系统 URL',
    autoFix: false,
  },
} as const;

export type MigrateErrorCode = keyof typeof MIGRATE_ERROR_CODES;

// ============================================================
// 类型定义
// ============================================================

/**
 * 验证问题
 */
export interface ValidationIssue {
  entityId: string;
  entityType: EntityType;
  code: MigrateErrorCode;
  message: string;
  fix: string;
  autoFix: boolean;
  severity: 'error' | 'warning';
}

/**
 * 验证结果
 */
export interface ValidationResult {
  success: boolean;
  scanned: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/**
 * 验证选项
 */
export interface ValidateOptions {
  /** 仅检查特定状态 */
  status?: EntityStatus;
  /** 仅检查特定实体 */
  entityIds?: string[];
}

// ============================================================
// 验证规则
// ============================================================

/**
 * source_project 格式正则
 * 只能包含小写字母、数字和连字符
 */
const SOURCE_PROJECT_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

/**
 * source_repo 格式正则
 * 推荐格式: owner/repo
 */
const SOURCE_REPO_PATTERN = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/;

/**
 * Domain/Enterprise 层级的 scope 值
 */
const NON_PROJECT_SCOPES = ['domain', 'enterprise'];

/**
 * 需要 source_project 的实体类型
 */
const PROJECT_LEVEL_TYPES: EntityType[] = [
  'system',
  'container',
  'component',
  'adr',
  'contract',
];

// ============================================================
// DataValidator 类
// ============================================================

/**
 * 数据验证器
 *
 * 设计文档: appendix.md §A.9.3.1
 */
export class DataValidator {
  private store: SQLiteStore;

  constructor(store?: SQLiteStore) {
    this.store = store || SQLiteStore.getInstance();
  }

  /**
   * 验证所有实体
   */
  validate(options: ValidateOptions = {}): ValidationResult {
    const db = this.store.getDatabase();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    // 构建查询
    let query = `
      SELECT e.id, e.type, e.scope, e.data,
             m.source_project, m.source_repo, m.external_url, m.status
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    `;

    const params: SQLQueryBindings[] = [];
    const conditions: string[] = [];

    if (options.status) {
      conditions.push('m.status = ?');
      params.push(options.status);
    }

    if (options.entityIds && options.entityIds.length > 0) {
      const placeholders = options.entityIds.map(() => '?').join(', ');
      conditions.push(`e.id IN (${placeholders})`);
      params.push(...options.entityIds);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    interface RawEntity {
      id: string;
      type: EntityType;
      scope: string | null;
      data: string;
      source_project: string | null;
      source_repo: string | null;
      external_url: string | null;
      status: EntityStatus;
    }

    const entities = db.prepare(query).all(...params) as RawEntity[];

    for (const entity of entities) {
      const data = typeof entity.data === 'string'
        ? JSON.parse(entity.data)
        : entity.data;

      const issues = this.validateEntity(entity, data);

      for (const issue of issues) {
        if (issue.severity === 'error') {
          errors.push(issue);
        } else {
          warnings.push(issue);
        }
      }
    }

    return {
      success: errors.length === 0,
      scanned: entities.length,
      errors,
      warnings,
    };
  }

  /**
   * 验证单个实体
   */
  private validateEntity(
    entity: {
      id: string;
      type: EntityType;
      scope: string | null;
      source_project: string | null;
      source_repo: string | null;
      external_url: string | null;
    },
    data: Record<string, unknown>
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const isExternal = data.external === true;
    const externalUrl = entity.external_url
      ?? (typeof data.external_url === 'string' ? data.external_url : null);
    const isNonProjectScope = entity.scope && NON_PROJECT_SCOPES.includes(entity.scope);
    const isProjectLevel = PROJECT_LEVEL_TYPES.includes(entity.type);

    // 检查 external 实体
    if (isExternal) {
      // external 实体不应有 source_project
      if (entity.source_project) {
        issues.push(this.createIssue(entity, 'C4A-MIGRATE-007', 'warning'));
      }
      // external 实体应有 external_url
      if (!externalUrl) {
        issues.push(this.createIssue(entity, 'C4A-MIGRATE-008', 'warning'));
      }
      return issues;
    }

    // 检查 Domain/Enterprise 层级
    if (isNonProjectScope) {
      if (entity.source_project) {
        issues.push(this.createIssue(entity, 'C4A-MIGRATE-005', 'warning'));
      }
      if (entity.source_repo) {
        issues.push(this.createIssue(entity, 'C4A-MIGRATE-006', 'warning'));
      }
      return issues;
    }

    // 检查 Project 层级实体
    if (isProjectLevel) {
      // 缺少 source_project
      if (!entity.source_project) {
        issues.push(this.createIssue(entity, 'C4A-MIGRATE-001', 'error'));
      } else if (!SOURCE_PROJECT_PATTERN.test(entity.source_project)) {
        // source_project 格式不正确
        issues.push(this.createIssue(entity, 'C4A-MIGRATE-003', 'error'));
      }

      // 缺少 source_repo
      if (!entity.source_repo) {
        issues.push(this.createIssue(entity, 'C4A-MIGRATE-002', 'error'));
      } else if (!SOURCE_REPO_PATTERN.test(entity.source_repo)) {
        // source_repo 格式建议改进
        issues.push(this.createIssue(entity, 'C4A-MIGRATE-004', 'warning'));
      }
    }

    return issues;
  }

  /**
   * 创建验证问题
   */
  private createIssue(
    entity: { id: string; type: EntityType },
    code: MigrateErrorCode,
    severity: 'error' | 'warning'
  ): ValidationIssue {
    const errorDef = MIGRATE_ERROR_CODES[code];
    return {
      entityId: entity.id,
      entityType: entity.type,
      code,
      message: errorDef.message,
      fix: errorDef.fix,
      autoFix: errorDef.autoFix,
      severity,
    };
  }

  /**
   * 格式化验证结果
   */
  static formatResult(
    result: ValidationResult,
    format: 'text' | 'json' = 'text'
  ): string {
    if (format === 'json') {
      return JSON.stringify(result, null, 2);
    }

    const lines: string[] = [];

    lines.push('=== 数据完整性校验 ===');
    lines.push('');
    lines.push(`已扫描 ${result.scanned} 个实体`);
    lines.push('');

    if (result.errors.length > 0) {
      lines.push(`❌ 发现 ${result.errors.length} 个错误:`);
      lines.push('');

      const grouped = this.groupByEntity(result.errors);
      for (const [entityId, issues] of Object.entries(grouped)) {
        const first = issues[0];
        lines.push(`  ${entityId} (${first.entityType}):`);
        for (const issue of issues) {
          lines.push(`    - [${issue.code}] ${issue.message}`);
          lines.push(`      修复: ${issue.fix}`);
        }
        lines.push('');
      }
    }

    if (result.warnings.length > 0) {
      lines.push(`⚠️ 发现 ${result.warnings.length} 个警告:`);
      lines.push('');

      const grouped = this.groupByEntity(result.warnings);
      for (const [entityId, issues] of Object.entries(grouped)) {
        const first = issues[0];
        lines.push(`  ${entityId} (${first.entityType}):`);
        for (const issue of issues) {
          lines.push(`    - [${issue.code}] ${issue.message}`);
          lines.push(`      建议: ${issue.fix}`);
        }
        lines.push('');
      }
    }

    if (result.success) {
      lines.push('✅ 数据完整性检查通过');
    } else {
      lines.push('=================================================');
      lines.push(`总计: ${result.errors.length} 个错误, ${result.warnings.length} 个警告`);
      lines.push('');
      lines.push('⚠️ 迁移到 Server 模式前必须修复所有错误');
      lines.push('使用 repair 自动修复这些问题');
    }

    return lines.join('\n');
  }

  /**
   * 按实体分组问题
   */
  private static groupByEntity(
    issues: ValidationIssue[]
  ): Record<string, ValidationIssue[]> {
    const grouped: Record<string, ValidationIssue[]> = {};
    for (const issue of issues) {
      if (!grouped[issue.entityId]) {
        grouped[issue.entityId] = [];
      }
      grouped[issue.entityId].push(issue);
    }
    return grouped;
  }
}
