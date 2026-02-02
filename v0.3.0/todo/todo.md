# v0.3.0 延后任务清单

> 本文档记录 v0.3.0 版本中延后到未来版本实现的任务。

---

## Part 11 权限与错误处理

本版本实现 **Part 11 Lite**（安全工具），以下任务延后到 v0.4.0：

### 权限系统（延后）

| 原任务编号 | 任务 | 设计文档位置 | 延后原因 |
|-----------|------|-------------|---------|
| 11.1-11.5 | 权限模式差异处理 | cross-project-auth.md §1.1 | 需要 Server 模式 |
| 11.6-11.12 | 权限检查器 + 配置 + 审计 | cross-project-auth.md §1.2-1.7 | 需要完整权限系统 |

### 错误恢复（延后）

| 原任务编号 | 任务 | 设计文档位置 | 延后原因 |
|-----------|------|-------------|---------|
| 11.13-11.21 | 错误响应格式化 | error-recovery.md §2.2-2.7 | errors.ts 已有完整实现 |
| 11.22-11.27 | 错误码规范 | error-codes.md §3 | errors.ts 已有完整实现 |

---

## Part 06 Local 模式

| 原任务编号 | 任务 | 设计文档位置 | 延后原因 |
|-----------|------|-------------|---------|
| 6.20 | Local→Server 切换 | mode-switch.md | 依赖 Server API |
| 6.21 | Server→Local 切换 | mode-switch.md | 依赖 Server 备份 |
| 6.24 | 性能基准测试 | appendix.md | 非核心功能 |

---

## Part 08 用户 CLI

| 原任务编号 | 任务 | 设计文档位置 | 延后原因 |
|-----------|------|-------------|---------|
| 8.13 | c4a rollback | user-cli.md | 紧急回滚命令，计划 v0.4.0 |

---

## 本版本实现内容

### Part 11 Lite 实现范围

| 模块 | 文件 | 说明 |
|------|------|------|
| Gateway 错误码 | types/errors.ts | 扩展 SYS-006~009（约 20 行改动） |
| 安全工具 | utils/security.ts | 路径校验、DSL 转义（新建） |

### 已有实现（复用，无需改动）

| 模块 | 文件 | 说明 |
|------|------|------|
| 错误码定义 | packages/core/src/types/errors.ts | 完整的 7 类错误码 |
| HTTP 状态码映射 | packages/core/src/types/errors.ts | ERROR_CODE_TO_HTTP_STATUS |
| 多语言消息 | packages/core/src/types/errors.ts | ERROR_MESSAGES |
| C4AError 基类 | packages/core/src/types/errors.ts | 错误类型体系 |
| MCP 错误响应 | packages/core/src/types/errors.ts | toMcpErrorResponse / errorToMcpResponse |

---

## 设计原则

> 不创建新目录，复用现有 `types/` 和 `utils/` 结构；不重复造轮子，`errors.ts` 已有完整错误处理基础设施。
