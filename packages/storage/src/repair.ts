/**
 * 数据修复模块
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/appendix.md §A.9.3.2
 *
 * 提供 Local 模式数据自动修复：
 * - 补全 root_id 字段
 * - 补全 source_repo 字段
 * - 修复字段格式
 * - 移除错误的层级字段
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SQLiteStore } from './sqlite-store.js';
import { DataValidator, type ValidationIssue, type MigrateErrorCode } from './validate.js';
import type { EntityType } from './adapter.js';
import { parseYAML, CONFIG_FILENAME, CONTEXT_ROOT_DIR } from '@c4a/core';

interface LocalProjectConfig {
  root_id?: string;
  repo_id?: string;
}

function loadLocalProjectConfig(basePath: string = process.cwd()): LocalProjectConfig | null {
  const configPath = join(basePath, CONTEXT_ROOT_DIR, CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    const content = readFileSync(configPath, 'utf-8');
    return parseYAML<LocalProjectConfig>(content);
  } catch {
    return null;
  }
}

// ============================================================
// 类型定义
// ============================================================

/**
 * 修复配置
 */
export interface RepairConfig {
  /** 默认 root_id */
  rootId?: string;
  /** 默认仓库 ID */
  repoId?: string;
}

/**
 * 修复选项
 */
export interface RepairOptions {
  /** 仅预览，不实际修改 */
  dryRun?: boolean;
  /** 仅修复特定实体 */
  entityIds?: string[];
}

/**
 * 修复动作
 */
export interface RepairAction {
  entityId: string;
  entityType: EntityType;
  code: MigrateErrorCode;
  action: 'fixed' | 'skipped';
  description: string;
  oldValue?: string | null;
  newValue?: string | null;
}

/**
 * 修复结果
 */
export interface RepairResult {
  success: boolean;
  dryRun: boolean;
  actions: RepairAction[];
  stats: {
    fixed: number;
    skipped: number;
  };
  manualRequired: RepairAction[];
}

// ============================================================
// DataRepair 类
// ============================================================

/**
 * 数据修复器
 *
 * 设计文档: appendix.md §A.9.3.2
 */
export class DataRepair {
  private store: SQLiteStore;
  private config: RepairConfig;
  private validator: DataValidator;

  constructor(config: RepairConfig = {}, store?: SQLiteStore) {
    this.store = store || SQLiteStore.getInstance();
    this.config = config;
    this.validator = new DataValidator(this.store);
  }

  /**
   * 修复数据完整性问题
   */
  repair(options: RepairOptions = {}): RepairResult {
    this.ensureConfig();
    const dryRun = options.dryRun ?? false;
    const actions: RepairAction[] = [];
    const manualRequired: RepairAction[] = [];

    // 先验证获取问题列表
    const validation = this.validator.validate({
      entityIds: options.entityIds,
    });

    const allIssues = [...validation.errors, ...validation.warnings];

    // 按实体分组处理
    const issuesByEntity = this.groupByEntity(allIssues);

    for (const [entityId, issues] of Object.entries(issuesByEntity)) {
      for (const issue of issues) {
        const action = this.repairIssue(issue, dryRun);
        if (action.action === 'skipped' && !issue.autoFix) {
          manualRequired.push(action);
        }
        actions.push(action);
      }
    }

    const fixed = actions.filter(a => a.action === 'fixed').length;
    const skipped = actions.filter(a => a.action === 'skipped').length;

    return {
      success: manualRequired.length === 0,
      dryRun,
      actions,
      stats: { fixed, skipped },
      manualRequired,
    };
  }

  /**
   * 修复单个问题
   */
  private repairIssue(issue: ValidationIssue, dryRun: boolean): RepairAction {
    if (!issue.autoFix) {
      return {
        entityId: issue.entityId,
        entityType: issue.entityType,
        code: issue.code,
        action: 'skipped',
        description: `跳过: ${issue.message}（需要手动处理）`,
      };
    }

    switch (issue.code) {
      case 'C4A-MIGRATE-001':
        return this.fixMissingSourceProject(issue, dryRun);
      case 'C4A-MIGRATE-002':
        return this.fixMissingSourceRepo(issue, dryRun);
      case 'C4A-MIGRATE-003':
        return this.fixSourceProjectFormat(issue, dryRun);
      case 'C4A-MIGRATE-005':
      case 'C4A-MIGRATE-006':
      case 'C4A-MIGRATE-007':
        return this.removeField(issue, dryRun);
      default:
        return {
          entityId: issue.entityId,
          entityType: issue.entityType,
          code: issue.code,
          action: 'skipped',
          description: `跳过: 未知错误码 ${issue.code}`,
        };
    }
  }

  /**
   * 修复缺少 root_id
   */
  private fixMissingSourceProject(issue: ValidationIssue, dryRun: boolean): RepairAction {
    const newValue = this.config.rootId;

    if (!newValue) {
      return {
        entityId: issue.entityId,
        entityType: issue.entityType,
        code: issue.code,
        action: 'skipped',
        description: '跳过: 未配置默认 root_id',
      };
    }

    if (!dryRun) {
      this.updateEntityField(issue.entityId, 'root_id', newValue);
    }

    return {
      entityId: issue.entityId,
      entityType: issue.entityType,
      code: issue.code,
      action: 'fixed',
      description: `补全 root_id: ${newValue}`,
      oldValue: null,
      newValue,
    };
  }

  /**
   * 修复缺少 source_repo
   */
  private fixMissingSourceRepo(issue: ValidationIssue, dryRun: boolean): RepairAction {
    const newValue = this.config.repoId;

    if (!newValue) {
      return {
        entityId: issue.entityId,
        entityType: issue.entityType,
        code: issue.code,
        action: 'skipped',
        description: '跳过: 未配置默认 repoId',
      };
    }

    if (!dryRun) {
      this.updateMetadataField(issue.entityId, 'source_repo', newValue);
    }

    return {
      entityId: issue.entityId,
      entityType: issue.entityType,
      code: issue.code,
      action: 'fixed',
      description: `补全 source_repo: ${newValue}`,
      oldValue: null,
      newValue,
    };
  }

  /**
   * 修复 root_id 格式
   */
  private fixSourceProjectFormat(issue: ValidationIssue, dryRun: boolean): RepairAction {
    const db = this.store.getDatabase();

    // 获取当前值
    const row = db.prepare(`
      SELECT root_id FROM entities WHERE id = ? LIMIT 1
    `).get(issue.entityId) as { root_id: string } | undefined;

    if (!row) {
      return {
        entityId: issue.entityId,
        entityType: issue.entityType,
        code: issue.code,
        action: 'skipped',
        description: '跳过: 实体不存在',
      };
    }

    const oldValue = row.root_id;
    // 转换为小写，替换非法字符为连字符
    const newValue = oldValue
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!dryRun) {
      this.updateEntityField(issue.entityId, 'root_id', newValue);
    }

    return {
      entityId: issue.entityId,
      entityType: issue.entityType,
      code: issue.code,
      action: 'fixed',
      description: `修复 root_id 格式: ${oldValue} → ${newValue}`,
      oldValue,
      newValue,
    };
  }

  /**
   * 移除不应存在的字段
   */
  private removeField(issue: ValidationIssue, dryRun: boolean): RepairAction {
    const fieldName = this.getFieldNameFromCode(issue.code);

    if (!dryRun) {
      if (fieldName === 'root_id') {
        this.updateEntityField(issue.entityId, fieldName, '');
      } else {
        this.updateMetadataField(issue.entityId, fieldName, null);
      }
    }

    return {
      entityId: issue.entityId,
      entityType: issue.entityType,
      code: issue.code,
      action: 'fixed',
      description: `移除不应存在的 ${fieldName} 字段`,
    };
  }

  /**
   * 根据错误码获取字段名
   */
  private getFieldNameFromCode(code: MigrateErrorCode): string {
    switch (code) {
      case 'C4A-MIGRATE-005':
      case 'C4A-MIGRATE-007':
        return 'root_id';
      case 'C4A-MIGRATE-006':
        return 'source_repo';
      default:
        return 'unknown';
    }
  }

  /**
   * 更新 metadata 表字段
   */
  private updateMetadataField(
    entityId: string,
    field: string,
    value: string | null
  ): void {
    const db = this.store.getDatabase();
    db.prepare(
      `
      UPDATE metadata
      SET ${field} = ?
      WHERE entity_uuid IN (SELECT uuid FROM entities WHERE id = ?)
    `
    ).run(value, entityId);
  }

  private updateEntityField(entityId: string, field: string, value: string): void {
    const db = this.store.getDatabase();
    db.prepare(
      `
      UPDATE entities
      SET ${field} = ?
      WHERE id = ?
    `
    ).run(value, entityId);
  }

  /**
   * 按实体分组问题
   */
  private groupByEntity(
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

  /**
   * 格式化修复结果
   */
  static formatResult(result: RepairResult): string {
    const lines: string[] = [];

    lines.push('=== 数据完整性修复 ===');
    lines.push('');

    if (result.dryRun) {
      lines.push('⚠️ 预览模式（不实际修改）');
      lines.push('');
    }

    for (const action of result.actions) {
      const icon = action.action === 'fixed' ? '✅' : '⏭️';
      lines.push(`${action.entityId} (${action.entityType}):`);
      lines.push(`  ${icon} ${action.description}`);
    }

    lines.push('');
    lines.push('=================================================');
    lines.push(`修复完成:`);
    lines.push(`  - 成功: ${result.stats.fixed} 个实体`);
    lines.push(`  - 跳过: ${result.stats.skipped} 个实体`);

    if (result.manualRequired.length > 0) {
      lines.push('');
      lines.push('⚠️ 以下实体需要手动处理:');
      for (const action of result.manualRequired) {
        lines.push(`  - ${action.entityId}: ${action.description}`);
      }
    }

    return lines.join('\n');
  }

  private ensureConfig(): void {
    if (this.config.rootId && this.config.repoId) {
      return;
    }
    const fileConfig = loadLocalProjectConfig();
    if (!fileConfig) {
      return;
    }
    if (!this.config.rootId && fileConfig.root_id) {
      this.config.rootId = fileConfig.root_id;
    }
    if (!this.config.repoId && fileConfig.repo_id) {
      this.config.repoId = fileConfig.repo_id;
    }
  }
}
