# Part 11 权限与错误处理 - Agent 提示词

> 执行顺序：Agent-0（前置准备）→ Agent-1~4 并行 → Agent-5（集成收尾）

---

## 概述

权限与错误处理模块实现跨项目权限控制和统一错误处理机制，包括：

| 子模块 | 设计文档 | 核心能力 | 任务编号 |
|--------|---------|---------|---------|
| 模式差异处理 | [cross-project-auth.md](../v0.3.0/detailed-design/permissions/cross-project-auth.md) | Local 跳过鉴权、Server 严格检查、数据完整性 | 11.1-11.5 |
| 权限模型 | [cross-project-auth.md](../v0.3.0/detailed-design/permissions/cross-project-auth.md) | Admin/Writer/Reader 角色、权限检查时机 | 11.6-11.12 |
| 错误分类与处理 | [error-recovery.md](../v0.3.0/detailed-design/permissions/error-recovery.md) | 错误分类、分层职责、恢复机制 | 11.13-11.21 |
| 错误码规范 | [error-codes.md](../v0.3.0/detailed-design/permissions/error-codes.md) | 错误码格式、完整映射表、安全校验 | 11.22-11.30 |

**依赖关系**：
- 依赖 Part 13 Server 模式的 storage-backend 权限服务
- 依赖 Part 06 Local 模式的 LiteAdapter
- 依赖 Part 08 User CLI 的命令框架

**优先级说明**：

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P0 | 11.1-11.5, 11.13-11.14, 11.22-11.25 | 基础权限检查 + 错误码框架 |
| P1 | 11.6-11.12, 11.15-11.18 | 完整权限模型 + Skill 错误处理 |
| P2 | 11.19-11.21, 11.26-11.30 | 归档检查 + 安全校验 + 未来优化 |

---

## Agent-0：前置准备（必须先完成）

```
请执行 Part 11 权限与错误处理的前置准备任务：

1. 阅读设计文档：
   - v0.3.0/detailed-design/permissions/cross-project-auth.md（完整阅读）
   - v0.3.0/detailed-design/permissions/error-recovery.md（完整阅读）
   - v0.3.0/detailed-design/permissions/error-codes.md（完整阅读）

2. 确认 Part 13 Server 模式已完成：
   - storage-backend 权限服务已实现（permissions.py）
   - 权限中间件已集成（middleware.py）
   - ServerAdapter 已支持权限检查

3. 创建权限模块目录结构：
   packages/core/src/permissions/
   ├── index.ts                    # 统一导出
   ├── types.ts                    # 权限相关类型
   ├── checker.ts                  # 权限检查器
   ├── provider.ts                 # 权限提供者接口
   └── auditor.ts                  # 权限审计日志

4. 创建错误处理模块目录结构：
   packages/core/src/errors/
   ├── index.ts                    # 统一导出（已存在，需扩展）
   ├── codes.ts                    # 错误码定义
   ├── messages.ts                 # 多语言错误消息
   ├── response.ts                 # 错误响应格式化
   └── recovery.ts                 # 可恢复操作定义

5. 类型定义（packages/core/src/permissions/types.ts）：

   【权限角色】
   type PermissionRole = 'admin' | 'writer' | 'reader';

   【项目权限】
   interface ProjectPermission {
     project_id: string;
     user_id: string;
     role: PermissionRole;
     granted_at: string;
     granted_by?: string;
   }

   【权限检查结果】
   interface PermissionCheckResult {
     allowed: boolean;
     reason?: string;
     missing_permissions?: string[];
   }

   【权限审计日志】
   interface PermissionAuditLog {
     timestamp: string;
     user: string;
     action: string;
     resource: string;
     result: 'granted' | 'denied';
     reason?: string;
   }

6. 错误类型定义（packages/core/src/errors/codes.ts）：

   【错误类别】
   type ErrorCategory = 'INPUT' | 'DATA' | 'SYS' | 'BIZ' | 'STORE' | 'PERM' | 'MIGRATE';

   【错误码映射】
   - 定义完整的错误码常量（参考 error-codes.md §3.2）
   - 包含 HTTP 状态码映射
   - 包含恢复建议

7. 产物：
   - 目录结构创建完成
   - 类型定义文件完成
   - 错误码常量定义完成
   - 确认依赖的 Part 13 模块可用

完成后告诉我，我会启动 Agent-1~4 并行执行。
```

---

## Agent-1：模式差异处理（11.1-11.5）

```
请实现模式差异处理模块。

1. 阅读设计文档：
   - v0.3.0/detailed-design/permissions/cross-project-auth.md §1.1（完整阅读）
   - 重点关注：
     - §1.1.1 Local 模式的权限处理
     - §1.1.2 Server/Remote 模式的权限处理
     - §1.1.3 Local → Server 数据迁移时的权限校验

2. 任务 11.1 - 模式差异处理：
   - 实现 packages/core/src/permissions/checker.ts
     - getRunMode(): 'local' | 'server' | 'remote'
     - isPermissionCheckRequired(): boolean
   - Local 模式跳过鉴权，Server/Remote 严格检查
   - 模式判断基于 .c4a.yaml 配置

3. 任务 11.2 - Local 数据完整性：
   - 在 checker.ts 中实现数据完整性检查
     - validateDataIntegrity(entity: Entity): ValidationResult
   - source_project 必填 + 自动填充
   - source_repo 必填 + 自动填充（从 Git remote 或配置获取）
   - 无法确定时显式报错（不允许创建"无主实体"）

4. 任务 11.3 - Server/Remote 权限：
   - 实现 packages/core/src/permissions/provider.ts
     - PermissionProvider 接口定义
     - LocalPermissionProvider（始终返回 true）
     - ServerPermissionProvider（调用 storage-backend API）
   - 用户上下文获取：
     - Server 模式：从 HTTP Session 或 JWT Token
     - Remote 模式：从 API Token

5. 任务 11.4 - Local→Server 迁移：
   - 在 packages/storage/src/migration/ 目录实现
     - checkMigrationPermissions(backupData, currentUser): MigrationCheckResult
     - migrateEntityToServer(entity, currentUser): Entity
   - 迁移时权限检查：
     - 检查用户是否有目标项目的写权限
     - 部分成功模式（允许部分实体导入成功）
   - 权限预检查命令支持

5. 任务 11.5 - 权限元数据映射：
   - 在 migrateEntityToServer 中实现
   - 补全 owner、created_by、updated_by 字段
   - 添加迁移审计字段（migrated_from、migrated_at、migrated_by）

6. 测试用例（写到 packages/core/src/permissions/__tests__/）：
   - checker.test.ts：模式判断、数据完整性检查
   - provider.test.ts：权限提供者接口
   - migration.test.ts：迁移权限检查
```

---

## Agent-2：权限模型（11.6-11.12）

```
请实现权限模型模块。

1. 阅读设计文档：
   - v0.3.0/detailed-design/permissions/cross-project-auth.md §1.2-1.7（完整阅读）
   - 重点关注：
     - §1.2 权限模型（Admin/Writer/Reader）
     - §1.3 权限变更的处理
     - §1.4 权限检查时机
     - §1.5 权限配置

2. 任务 11.6 - 权限模型：
   - 在 packages/core/src/permissions/checker.ts 中扩展
     - checkWritePermission(user, project): Promise<PermissionCheckResult>
     - checkApprovePermission(user, project): Promise<PermissionCheckResult>
     - checkReadPermission(user, project): Promise<PermissionCheckResult>
   - 角色定义：
     - Admin：读写 + 批准发布
     - Writer：读写
     - Reader：只读

3. 任务 11.7 - 权限变更处理：
   - 实现权限变更场景处理
   - 创建时无权限，后获得权限：用户可重新尝试
   - 创建时有权限，发布前被撤销：发布时再次检查
   - 发布后权限被撤销：不影响已发布实体

4. 任务 11.8 - 创建时权限检查：
   - 在 c4a_store_save 中集成权限检查
     - checkCreatePermission(user, params, featContext): Promise<string>
   - 跨项目 feat 必须显式指定 source_project
   - 单项目 feat 可自动填充当前项目

5. 任务 11.9 - 修改/发布权限检查：
   - checkUpdatePermission(user, entityId): Promise<void>
   - checkPublishPermission(user, featId): Promise<void>
   - 修改时检查实体所属项目的写权限
   - 发布时检查所有涉及项目的批准权限

6. 任务 11.10 - 跨项目发布权限：
   - checkCrossProjectPublishPermission(user, featId): Promise<void>
   - 需要所有涉及项目的 Admin 权限
   - 缺少权限时返回详细错误信息

7. 任务 11.11 - 权限配置：
   - 实现 packages/core/src/permissions/config.ts
     - loadPermissionConfig(): PermissionConfig
     - 支持 .c4a.yaml 中的 permissions 配置
   - 配置格式：
     ```yaml
     permissions:
       projects:
         backend-api:
           admins: [alice, bob]
           writers: [charlie]
           readers: [eve]
     ```

8. 任务 11.12 - 权限实现建议：
   - 实现 packages/core/src/permissions/auditor.ts
     - logPermissionCheck(entry: PermissionAuditLog): Promise<void>
     - queryAuditLogs(filters): Promise<PermissionAuditLog[]>
   - 支持集成外部权限系统（LDAP、OAuth）的接口预留

9. 测试用例（写到 packages/core/src/permissions/__tests__/）：
   - model.test.ts：权限模型、角色检查
   - config.test.ts：权限配置加载
   - auditor.test.ts：审计日志记录
```

---

## Agent-3：错误分类与处理（11.13-11.21）

```
请实现错误分类与处理模块。

1. 阅读设计文档：
   - v0.3.0/detailed-design/permissions/error-recovery.md（完整阅读）
   - 重点关注：
     - §2.1 错误分类
     - §2.2 错误处理原则
     - §2.2.1 错误处理的分层职责
     - §2.3-2.6 各 Skill 错误处理
     - §2.7 恢复机制

2. 任务 11.13 - 错误分类：
   - 实现 packages/core/src/errors/codes.ts
   - 定义错误类型枚举：
     - INPUT：用户输入错误
     - DATA：数据一致性错误
     - SYS：系统错误
     - BIZ：业务逻辑错误
     - PERM：权限错误
   - 每种类型包含恢复策略说明

3. 任务 11.14 - 错误处理原则：
   - 实现 packages/core/src/errors/response.ts
     - formatErrorResponse(error): McpErrorResponse
     - createRecoverableAction(action, label, params): RecoverableAction
   - 原则实现：
     - 明确错误原因
     - 提供修复建议
     - 保护数据完整性
     - 记录错误日志
     - 用户友好消息

4. 任务 11.15 - 分层错误处理：
   - MCP 工具层：返回结构化错误响应
   - CLI 层：呈现交互式选项
   - Agent 层：自主决策或询问用户
   - 实现 McpErrorResponse 接口：
     ```typescript
     interface McpErrorResponse {
       code: string;
       message: string;
       details?: object;
       timestamp: string;
       request_id?: string;
       recoverable_actions?: RecoverableAction[];
     }
     ```

5. 任务 11.16 - Skill 错误处理：
   - 实现 packages/core/src/errors/recovery.ts
   - /c4a:implement 错误处理：
     - 前置条件检查失败（feat 状态为 draft）
     - 实现清单生成失败（Technical Spec 不完整）
   - /c4a:analyze 错误处理：
     - 一致性检查失败（错误/警告分类展示）
   - /c4a:feat --status=published 错误处理：
     - 合并冲突
     - 部分合并失败
     - 一致性检查失败

6. 任务 11.17 - 系统错误处理：
   - 数据库连接失败：
     - 自动重试 3 次（间隔 1s, 2s, 4s）
     - 提供降级方案
   - MCP 工具调用失败：
     - 记录错误日志
     - 提供重试/跳过/取消选项

7. 任务 11.18 - 恢复机制：
   - 实现 packages/core/src/errors/operationLog.ts
     - logOperation(log: OperationLog): Promise<void>
     - queryOperations(filters): Promise<OperationLog[]>
   - 操作日志记录所有关键操作
   - 支持回滚的操作：feat 发布、实体修改、状态流转

8. 任务 11.19 - 归档检查：
   - 实现 canArchive(entityId): Promise<ArchiveCheckResult>
   - 检查条件：
     - 最小保留期（默认 30 天）
     - 无活跃引用（无 published 实体引用）
     - 无 feat 引用（无 draft/approved feat 引用）
     - 人工确认（可配置）

9. 任务 11.20 - Server 数据修复：
   - 集成 c4a_store_repair 工具
   - 支持 --dry-run 检测不一致
   - 支持 --scope=neo4j/milvus/all
   - 支持 --entity-ids 指定实体

10. 任务 11.21 - 数据备份：
    - 实现自动备份配置
    - BackupConfig 接口：
      - enabled: boolean
      - interval: string (cron 表达式)
      - retention: number (保留天数)
      - location: string (备份目录)
    - 清理过期备份

11. 测试用例（写到 packages/core/src/errors/__tests__/）：
    - response.test.ts：错误响应格式化
    - recovery.test.ts：可恢复操作
    - operationLog.test.ts：操作日志
    - archive.test.ts：归档检查
```

---

## Agent-4：错误码规范与安全（11.22-11.30）

```
请实现错误码规范与安全模块。

1. 阅读设计文档：
   - v0.3.0/detailed-design/permissions/error-codes.md（完整阅读）
   - 重点关注：
     - §3.1 错误码格式
     - §3.2 完整错误码映射表
     - §5 输入验证与输出安全

2. 任务 11.22 - 错误码格式：
   - 格式：C4A-{类别}-{编号}
   - 类别：INPUT, DATA, SYS, BIZ, STORE, PERM, MIGRATE
   - 实现 packages/core/src/errors/codes.ts
     - parseErrorCode(code): { category, number }
     - getHttpStatus(code): number
     - getRecoverySuggestion(code): string

3. 任务 11.23 - 错误码使用指南：
   - Agent 只需关注类别，细粒度编号用于日志追踪
   - 实现 handleMcpError(error) 示例函数
   - 按类别定义 Agent 行为：
     - INPUT：检查参数，修正后重试
     - DATA：检查数据依赖
     - SYS：等待后重试
     - BIZ：根据 recoverable_actions 决定
     - PERM：提示用户权限不足

4. 任务 11.24 - 完整错误码表：
   - 实现 packages/core/src/errors/codes.ts 中的完整映射
   - INPUT 类（C4A-INPUT-001~007）
   - DATA 类（C4A-DATA-001~007）
   - SYS 类（C4A-SYS-001~005）
   - BIZ 类（C4A-BIZ-001~006）
   - STORE 类（C4A-STORE-001~004）
   - PERM 类（C4A-PERM-001~005）
   - MIGRATE 类（C4A-MIGRATE-001~008）

5. 任务 11.25 - 错误响应格式：
   - 实现 ErrorResponse 接口
   - 包含：code, message, details, timestamp, request_id, recoverable_actions
   - details 包含：field, expected, actual, suggestion

6. 任务 11.26 - 多语言错误消息：
   - 实现 packages/core/src/errors/messages.ts
     - getErrorMessage(code, lang): string
   - 支持中文和英文
   - 通过 Accept-Language 或配置指定

7. 任务 11.27 - 最佳实践：
   - 错误处理：提前检查、原子操作、详细日志
   - 权限控制：最小权限、定期审计、权限分离
   - 恢复机制：定期备份、操作日志、回滚支持

8. 任务 11.28 - DSL 注入防护：
   - 实现 packages/core/src/utils/security.ts
     - escapeHtml(text): string
     - escapeMermaidString(text): string
   - 输入阶段：不过滤原始内容，Schema 验证，长度限制
   - 输出阶段：HTML 转义，Mermaid 转义

9. 任务 11.29 - 路径安全校验：
   - 实现 validatePath(inputPath, projectRoot): ValidationResult
   - 校验规则：
     - 禁止父目录引用（..）
     - 禁止绝对路径
     - 限制在项目根目录内
     - 禁止符号链接逃逸
   - TOCTOU 漏洞防护：
     - 使用 O_NOFOLLOW
     - 打开后再次验证真实路径

10. 任务 11.30 - 未来优化方向：
    - 短期（v0.3.x）：完善错误码、增加恢复场景、优化提示
    - 长期（v0.4.0+）：细粒度权限、分布式事务、多租户隔离

11. 测试用例（写到 packages/core/src/errors/__tests__/）：
    - codes.test.ts：错误码解析、HTTP 状态码映射
    - messages.test.ts：多语言消息
    - security.test.ts：HTML/Mermaid 转义
    - path.test.ts：路径安全校验
```

---

## Agent-5：集成收尾（等待 Agent-1~4 全部完成）

```
请执行 Part 11 权限与错误处理的集成收尾任务。

1. 阅读设计文档：
   - 确认所有模块已实现
   - 检查与 Part 13 Server 模式的集成

2. 集成任务：
   - 更新 packages/core/src/permissions/index.ts
     - 统一导出所有权限模块
   - 更新 packages/core/src/errors/index.ts
     - 统一导出所有错误处理模块
   - 更新 packages/core/src/index.ts
     - 添加 permissions 和 errors 模块导出

3. MCP 工具集成：
   - 更新 packages/mcp-store/src/tools/*.ts
     - 集成权限检查（checkWritePermission 等）
     - 使用统一错误响应格式
   - 更新 packages/mcp-query/src/tools/*.ts
     - 集成权限检查（checkReadPermission）

4. CLI 集成：
   - 更新 packages/cli/src/commands/server.ts
     - 集成 check-permissions 命令
   - 更新错误显示逻辑
     - 使用多语言错误消息
     - 显示可恢复操作选项

5. 创建集成测试：
   - packages/core/src/permissions/__tests__/integration.test.ts
     - 端到端权限检查流程
     - Local/Server 模式切换
   - packages/core/src/errors/__tests__/integration.test.ts
     - 错误响应格式化
     - 可恢复操作流程

6. 文档更新：
   - 更新 packages/core/README.md
     - 添加权限模块说明
     - 添加错误处理说明
   - 更新 CLAUDE.md
     - 添加错误码使用指南

7. 验证清单：
   - [ ] Local 模式跳过鉴权正常工作
   - [ ] Server 模式权限检查正常工作
   - [ ] 数据完整性检查（source_project 必填）
   - [ ] 权限元数据迁移补全
   - [ ] 错误码格式正确
   - [ ] 多语言错误消息
   - [ ] 路径安全校验
   - [ ] DSL 注入防护
   - [ ] 操作日志记录
   - [ ] 归档检查逻辑

8. 产物：
   - packages/core/src/permissions/ 完整实现
   - packages/core/src/errors/ 完整实现
   - MCP 工具权限集成
   - CLI 错误显示优化
   - 集成测试通过
   - README 文档更新
```

---

## 执行检查清单

| 步骤 | Agent | 任务编号 | 状态 | 完成时间 |
|------|-------|---------|:----:|---------|
| 1 | Agent-0 | 前置准备 | [ ] | |
| 2 | Agent-1 | 11.1-11.5 | [ ] | |
| 2 | Agent-2 | 11.6-11.12 | [ ] | |
| 2 | Agent-3 | 11.13-11.21 | [ ] | |
| 2 | Agent-4 | 11.22-11.30 | [ ] | |
| 3 | Agent-5 | 集成收尾 | [ ] | |

---

## 任务编号索引

| 编号 | 任务 | Agent |
|------|------|-------|
| 11.1 | 模式差异处理 | Agent-1 |
| 11.2 | Local 数据完整性 | Agent-1 |
| 11.3 | Server/Remote 权限 | Agent-1 |
| 11.4 | Local→Server 迁移 | Agent-1 |
| 11.5 | 权限元数据映射 | Agent-1 |
| 11.6 | 权限模型 | Agent-2 |
| 11.7 | 权限变更处理 | Agent-2 |
| 11.8 | 创建时权限检查 | Agent-2 |
| 11.9 | 修改/发布权限检查 | Agent-2 |
| 11.10 | 跨项目发布权限 | Agent-2 |
| 11.11 | 权限配置 | Agent-2 |
| 11.12 | 权限实现建议 | Agent-2 |
| 11.13 | 错误分类 | Agent-3 |
| 11.14 | 错误处理原则 | Agent-3 |
| 11.15 | 分层错误处理 | Agent-3 |
| 11.16 | Skill 错误处理 | Agent-3 |
| 11.17 | 系统错误处理 | Agent-3 |
| 11.18 | 恢复机制 | Agent-3 |
| 11.19 | 归档检查 | Agent-3 |
| 11.20 | Server 数据修复 | Agent-3 |
| 11.21 | 数据备份 | Agent-3 |
| 11.22 | 错误码格式 | Agent-4 |
| 11.23 | 错误码使用指南 | Agent-4 |
| 11.24 | 完整错误码表 | Agent-4 |
| 11.25 | 错误响应格式 | Agent-4 |
| 11.26 | 多语言错误消息 | Agent-4 |
| 11.27 | 最佳实践 | Agent-4 |
| 11.28 | DSL 注入防护 | Agent-4 |
| 11.29 | 路径安全校验 | Agent-4 |
| 11.30 | 未来优化方向 | Agent-4 |

---

## 关键设计决策

### 1. 模式差异处理

```
Local 模式：
- 跳过鉴权（单用户环境）
- 强制数据完整性（source_project 必填）
- 自动填充缺失字段

Server/Remote 模式：
- 严格权限检查
- 用户上下文从 Session/Token 获取
- 权限数据存储在 MongoDB
```

### 2. 权限检查时机

```
创建实体时 → 立即检查目标项目的写权限
修改实体时 → 检查实体所属项目的写权限
发布 feat 时 → 检查所有涉及项目的批准权限
```

### 3. 错误处理分层

```
MCP 工具层：返回结构化错误响应（code, message, recoverable_actions）
CLI 层：呈现交互式选项（基于 recoverable_actions）
Agent 层：自主决策或询问用户
```

### 4. 错误码设计

```
格式：C4A-{类别}-{编号}
类别：INPUT, DATA, SYS, BIZ, STORE, PERM, MIGRATE

Agent 只需关注类别，细粒度编号用于日志追踪
```

### 5. 安全策略

```
输入阶段：不过滤原始内容，Schema 验证，长度限制
输出阶段：HTML 转义，Mermaid 转义
路径校验：禁止 ..，禁止绝对路径，限制在项目根目录内
```

### 6. 迁移权限处理

```typescript
// Local → Server 迁移时
1. 检查用户是否有目标项目的写权限
2. 补全权限元数据（owner, created_by, updated_by）
3. 添加迁移审计字段（migrated_from, migrated_at, migrated_by）
4. 部分成功模式（允许部分实体导入成功）
```

---

## 与其他 Part 的关系

| Part | 关系 | 说明 |
|------|------|------|
| Part 06 | 依赖 | Local 模式的 LiteAdapter |
| Part 08 | 依赖 | User CLI 命令框架 |
| Part 13 | 依赖 | Server 模式的权限服务 |
| Part 03 | 被依赖 | MCP Store 工具集成权限检查 |
| Part 04 | 被依赖 | MCP Query 工具集成权限检查 |
| Part 10 | 被依赖 | Skills 错误处理集成 |

---
