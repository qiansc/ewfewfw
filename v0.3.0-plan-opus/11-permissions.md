# Part 11 Lite: 安全工具 - Agent 提示词

> 执行顺序：Agent-1 → Agent-2 → Agent-3（顺序执行）

---

## 概述

Part 11 Lite 聚焦于 HTTP 服务的安全底线：

| 模块 | 本版本实现 | 说明 |
|------|:---------:|------|
| **Gateway 错误码** | ✅ | 在现有 `errors.ts` 中扩展 4 个错误码 |
| **安全工具** | ✅ | 路径遍历防护、DSL 注入防护 |
| Server 鉴权 | ❌ | 延后到 v0.4.0 |
| 权限检查器 | ❌ | 延后到 v0.4.0 |
| 审计日志 | ❌ | 延后到 v0.4.0 |

**设计原则**：
- 不创建新目录，复用现有 `types/` 和 `utils/` 结构
- 不重复造轮子，`errors.ts` 已有完整错误处理基础设施
- 只做 v0.3.1 HTTP Gateway 真正需要的

**依赖关系**：
- 依赖 Part 01 Core 的 `types/errors.ts` 错误码体系
- 被 Part 13 Server Mode 依赖（Gateway 错误码）
- 被 Part 03/04 MCP Store/Query 依赖（路径安全校验）

---

## Agent-1：Gateway 错误码扩展

**允许修改的文件**：
- `packages/core/src/types/errors.ts`（扩展）
- `packages/core/src/types/__tests__/errors.test.ts`（扩展测试，如存在）

```
你作为 v0.3.0-plan-opus/11-permissions.md 里的 Agent-1 负责实现 Gateway 错误码扩展任务。

请在 errors.ts 中扩展 HTTP Gateway 相关错误码。

1. 阅读设计文档：
   - v0.3.0/detailed-design/permissions/error-codes.md §3.2（错误码表）

2. 在 SYS_ERROR_CODES 中新增：
   ```typescript
   export const SYS_ERROR_CODES = {
     // ... 现有错误码
     GATEWAY_TIMEOUT: 'C4A-SYS-006',           // Gateway 超时
     GATEWAY_BAD_GATEWAY: 'C4A-SYS-007',       // 上游服务错误
     GATEWAY_SERVICE_UNAVAILABLE: 'C4A-SYS-008', // Gateway 服务不可用
     TRANSPORT_ERROR: 'C4A-SYS-009',           // 传输层错误（stdio/http 通用）
   } as const;
   ```

3. 在 ERROR_CODE_TO_HTTP_STATUS 中新增映射：
   ```typescript
   'C4A-SYS-006': 504,  // Gateway Timeout
   'C4A-SYS-007': 502,  // Bad Gateway
   'C4A-SYS-008': 503,  // Service Unavailable
   'C4A-SYS-009': 500,  // Internal Server Error
   ```

4. 在 ERROR_MESSAGES 中新增多语言消息：
   ```typescript
   'C4A-SYS-006': { zh: 'Gateway 超时', en: 'Gateway timeout' },
   'C4A-SYS-007': { zh: '上游服务错误', en: 'Bad gateway' },
   'C4A-SYS-008': { zh: 'Gateway 服务不可用', en: 'Gateway service unavailable' },
   'C4A-SYS-009': { zh: '传输层错误', en: 'Transport error' },
   ```

5. 测试用例（如测试文件存在）：
   - 验证新错误码存在于 ERROR_CODES
   - 验证 HTTP 状态码映射正确
   - 验证多语言消息存在

6. 产物：
   - packages/core/src/types/errors.ts（扩展约 20 行）
```

---

## Agent-2：安全工具

**允许修改的文件**：
- `packages/core/src/utils/security.ts`（新建）
- `packages/core/src/utils/__tests__/security.test.ts`（新建测试）

> **注意**：导出文件（`utils/index.ts`、`index.ts`）由 Agent-3 统一处理，避免冲突。

```
你作为 v0.3.0-plan-opus/11-permissions.md 里的 Agent-2 负责实现安全工具模块。

请实现安全工具模块。

1. 阅读设计文档：
   - v0.3.0/detailed-design/permissions/error-codes.md §5 输入验证与输出安全

2. DSL 注入防护：
   ```typescript
   /**
    * HTML 转义（用于可视化渲染）
    * 转义字符：& < > " '
    */
   export function escapeHtml(text: string): string;

   /**
    * Mermaid 字符串转义（用于图表渲染）
    * 转义字符：" # ; 以及换行符
    */
   export function escapeMermaidString(text: string): string;
   ```

3. 路径安全校验：
   ```typescript
   interface PathValidationResult {
     valid: boolean;
     error?: string;
     errorCode?: string;  // C4A-INPUT-006 或 C4A-INPUT-007
   }

   /**
    * 验证路径安全性
    *
    * 输入要求：
    * - inputPath 必须是相对路径（不以 / 或盘符开头）
    * - 允许 ./ 前缀，会被标准化移除
    * - 路径分隔符统一使用 /（Windows \ 会被转换）
    *
    * 校验规则：
    * - 禁止父目录引用（..）
    * - 禁止绝对路径（/ 开头或 Windows 盘符）
    * - 解析后必须在 projectRoot 内
    * - 检查符号链接是否逃逸出 projectRoot
    *
    * @param inputPath - 待验证的相对路径
    * @param projectRoot - 项目根目录（绝对路径）
    */
   export function validatePath(
     inputPath: string,
     projectRoot: string
   ): Promise<PathValidationResult>;

   /**
    * TOCTOU 安全的文件读取
    *
    * 先验证路径，再读取文件。
    * 如果路径验证失败，抛出 InputError。
    *
    * 符号链接处理：
    * - Unix: 使用 lstat + realpath 校验，确保解析后路径在 projectRoot 内
    * - Windows: O_NOFOLLOW 不可用，使用 lstat + realpath 校验
    * - 读取前后都基于 realpath 校验最终路径仍在 projectRoot 内（防止 TOCTOU 竞态）
    *
    * @param inputPath - 待读取的相对路径
    * @param projectRoot - 项目根目录（绝对路径）
    * @throws InputError 如果路径验证失败
    */
   export function safeReadFile(
     inputPath: string,
     projectRoot: string
   ): Promise<Buffer>;
   ```

4. 测试用例：

   **测试文件位置**：`packages/core/src/utils/__tests__/security.test.ts`

   **临时文件规则**：测试中创建的临时文件/符号链接必须放在 `.tmp/` 目录或 `os.tmpdir()`，并在测试结束后清理。

   ```typescript
   describe('escapeHtml', () => {
     it('转义 HTML 特殊字符', () => {});
     it('空字符串返回空字符串', () => {});
     it('无特殊字符原样返回', () => {});
   });

   describe('escapeMermaidString', () => {
     it('转义 Mermaid 特殊字符', () => {});
     it('转义换行符', () => {});
   });

   describe('validatePath', () => {
     // 正常路径
     it('允许简单相对路径', () => {});  // 'foo/bar.txt'
     it('允许 ./ 前缀路径', () => {});  // './foo/bar.txt'
     it('标准化 Windows 路径分隔符', () => {});  // 'foo\\bar.txt' → 'foo/bar.txt'

     // 拒绝的路径
     it('拒绝父目录引用', () => {});  // '../secret.txt'
     it('拒绝隐藏的父目录引用', () => {});  // 'foo/../../secret.txt'
     it('拒绝绝对路径（Unix）', () => {});  // '/etc/passwd'
     it('拒绝绝对路径（Windows）', () => {});  // 'C:\\Windows'
     it('拒绝空路径', () => {});

     // 符号链接（在 .tmp/ 或 os.tmpdir() 创建临时符号链接）
     it('拒绝逃逸的符号链接', () => {});
   });

   describe('safeReadFile', () => {
     // 使用 .tmp/ 或 os.tmpdir() 创建临时测试文件
     it('正常读取项目内文件', () => {});
     it('拒绝读取项目外文件', () => {});
     it('拒绝通过符号链接读取项目外文件', () => {});
     it('文件不存在时抛出错误', () => {});
   });
   ```

5. 产物：
   - packages/core/src/utils/security.ts（新建）
   - packages/core/src/utils/__tests__/security.test.ts（新建）
```

---

## Agent-3：集成收尾

**允许修改的文件**：
- `packages/core/src/utils/index.ts`（如存在）
- `packages/core/src/index.ts`

```
你作为 v0.3.0-plan-opus/11-permissions.md 里的 Agent-3 负责实现集成收尾任务。

请执行 Part 11 Lite 的集成收尾任务。

1. 更新统一导出：
   - 如果 packages/core/src/utils/index.ts 存在：
     - 添加 `export * from './security.js';`
   - 更新 packages/core/src/index.ts：
     - 确保 security 模块可从 @c4a/core 导入

2. 验证清单：
   - [x] Gateway 错误码已添加（SYS-006~009）
   - [x] 路径安全校验可用
   - [x] DSL 注入防护可用
   - [x] 所有测试通过
   - [x] 类型检查通过 (bun run typecheck)
   - [x] 构建成功 (bun run build)

3. 产物：
   - packages/core/src/types/errors.ts（扩展 Gateway 错误码）
   - packages/core/src/utils/security.ts（新建）
   - packages/core/src/utils/__tests__/security.test.ts（新建）
```

---

## 执行检查清单

| 步骤 | Agent | 任务 | 产物 | 状态 |
|------|-------|------|------|:----:|
| 1 | Agent-1 | Gateway 错误码 | errors.ts 扩展 | [x] |
| 2 | Agent-2 | 安全工具 | security.ts + 测试 | [x] |
| 3 | Agent-3 | 集成收尾 | 导出 + 验证 | [x] |

---

## 延后到 v0.4.0 的任务

以下任务不在本版本实现：

| 原任务编号 | 任务 | 延后原因 |
|-----------|------|---------|
| 11.1-11.5 | 权限模式差异处理 | 需要 Server 模式 |
| 11.6-11.12 | 权限检查器 + 配置 + 审计 | 需要完整权限系统 |
| 11.13-11.21 | 错误响应格式化 | errors.ts 已有完整实现 |
| 11.22-11.27 | 错误码规范 | errors.ts 已有完整实现 |

---

## 与其他 Part 的关系

| Part | 关系 | 说明 |
|------|------|------|
| Part 13 | 被依赖 | Server 模式的 HTTP Gateway 需要 Gateway 错误码 |
| Part 03 | 被依赖 | MCP Store 工具使用路径安全校验 |
| Part 04 | 被依赖 | MCP Query 工具使用路径安全校验 |
