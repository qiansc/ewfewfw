## 3. 错误码规范

> **版本说明**：
>
> `packages/core/src/types/errors.ts` 已包含完整的错误码体系。
>
> **本版本新增**：Gateway 错误码（SYS-006~009），用于 HTTP Gateway 场景。

### 3.1 错误码格式

```
C4A-{类别}-{编号}
```

| 类别 | 说明 | 示例 |
|------|------|------|
| INPUT | 用户输入错误 | C4A-INPUT-001 |
| DATA | 数据一致性错误 | C4A-DATA-001 |
| SYS | 系统错误 | C4A-SYS-001 |
| BIZ | 业务逻辑错误 | C4A-BIZ-001 |
| STORE | 存储操作 | C4A-STORE-001 |
| PERM | 权限错误 | C4A-PERM-001 |
| MIGRATE | 数据迁移错误 | C4A-MIGRATE-001 |

### 3.1.1 错误码使用指南

> **设计原则**：错误码分为"类别"和"编号"两层。Agent 只需关注**类别**，细粒度编号用于日志追踪和人工排查。

**Agent 错误处理策略**：

| 错误类别 | Agent 行为 | 说明 |
|---------|-----------|------|
| `INPUT` | 检查参数，修正后重试 | 参数错误，查看 `details.field` 定位问题 |
| `DATA` | 检查数据依赖，可能需要先创建/修复数据 | 数据一致性问题 |
| `SYS` | 等待后重试，或报告系统问题 | 系统故障，非 Agent 可解决 |
| `BIZ` | 根据 `recoverable_actions` 决定下一步 | 业务规则限制 |
| `STORE` | 根据具体错误决定：警告可忽略，其他需处理 | 存储操作相关 |
| `PERM` | 提示用户权限不足，无法自动恢复 | 需要人工授权 |

**示例：Agent 错误处理逻辑**

```typescript
function handleMcpError(error: McpError) {
  const category = error.code.split('-')[1]; // 提取类别：INPUT, DATA, SYS, BIZ, PERM

  switch (category) {
    case 'INPUT':
      // 参数错误，查看 details.field 修正参数
      console.log(`参数错误: ${error.details?.field} - ${error.message}`);
      break;
    case 'DATA':
      // 数据问题，可能需要先创建依赖实体
      console.log(`数据问题: ${error.message}`);
      break;
    case 'SYS':
      // 系统错误，等待后重试
      console.log(`系统错误，稍后重试: ${error.message}`);
      break;
    case 'BIZ':
      // 业务规则，查看 recoverable_actions
      console.log(`业务限制: ${error.message}`);
      break;
    case 'PERM':
      // 权限不足，提示用户
      console.log(`权限不足: ${error.details?.project}`);
      break;
  }
}
```

> **注意**：细粒度错误码（如 `C4A-INPUT-005` 无效 ID 格式）主要用于：
> - 日志追踪和问题排查
> - CLI 显示具体错误信息
> - 文档和测试用例引用
>
> Agent 无需针对每个细粒度错误码编写特定处理逻辑。

### 3.2 完整错误码映射表

| 错误码 | HTTP 状态码 | 说明 | 恢复建议 |
|--------|------------|------|---------|
| **INPUT 类（用户输入错误）** ||||
| C4A-INPUT-001 | 400 | 缺少必填字段 | 补充缺失字段 |
| C4A-INPUT-002 | 400 | 字段格式错误 | 检查字段格式 |
| C4A-INPUT-003 | 400 | 字段值超出范围 | 检查字段值范围 |
| C4A-INPUT-004 | 400 | 无效的实体类型 | 使用有效的 type 值 |
| C4A-INPUT-005 | 400 | 无效的 ID 格式 | ID 只能包含字母、数字、连字符 |
| C4A-INPUT-006 | 400 | 路径遍历攻击 | 路径必须在项目根目录内 |
| C4A-INPUT-007 | 400 | 路径包含非法字符 | 路径不能包含 `..` 或绝对路径 |
| **DATA 类（数据一致性错误）** ||||
| C4A-DATA-001 | 404 | 引用的实体不存在 | 检查 entity_id 拼写或创建实体 |
| C4A-DATA-002 | 409 | 实体已存在 | 使用不同的 ID 或更新现有实体 |
| C4A-DATA-003 | 422 | 循环依赖 | 移除循环依赖关系 |
| C4A-DATA-004 | 422 | 悬空引用 | 创建被引用的实体 |
| C4A-DATA-005 | 409 | 版本冲突 | 获取最新版本后重试 |
| C4A-DATA-006 | 422 | 关系类型不匹配 | 检查关系类型是否正确 |
| C4A-DATA-007 | 422 | 跨层级引用无效 | 检查 scope 是否允许引用 |
| **SYS 类（系统错误）** ||||
| C4A-SYS-001 | 503 | 数据库连接失败 | 检查数据库服务和网络 |
| C4A-SYS-002 | 504 | MCP 工具调用超时 | 重试或检查服务状态 |
| C4A-SYS-003 | 500 | 内部服务错误 | 查看日志，联系管理员 |
| C4A-SYS-004 | 503 | 向量搜索服务不可用 | 检查 USearch 索引或 Milvus 服务 |
| C4A-SYS-005 | 503 | 远程服务不可用 | 检查远程服务地址和网络 |
| C4A-SYS-006 | 504 | Gateway 超时 | 检查上游服务响应时间 |
| C4A-SYS-007 | 502 | 上游服务错误 | 检查上游服务状态 |
| C4A-SYS-008 | 503 | Gateway 服务不可用 | 检查 Gateway 服务状态 |
| C4A-SYS-009 | 500 | 传输层错误 | 检查 stdio/HTTP 传输配置 |
| **BIZ 类（业务逻辑错误）** ||||
| C4A-BIZ-001 | 422 | 非法状态流转 | 按正确顺序流转状态 |
| C4A-BIZ-002 | 422 | feat 状态不允许操作 | 先流转 feat 状态 |
| C4A-BIZ-003 | 422 | 一致性检查失败 | 修复一致性错误后重试 |
| C4A-BIZ-004 | 422 | 合并冲突 | 解决冲突后重试 |
| C4A-BIZ-005 | 422 | 实体被引用，无法删除 | 先删除引用关系 |
| C4A-BIZ-006 | 422 | 跨项目 feat 需要多方批准 | 等待所有项目负责人批准 |
| **STORE 类（存储操作）** ||||
| C4A-STORE-001 | 200 | 并发修改警告 | 协调变更范围或继续修改 |
| C4A-STORE-002 | 422 | 缺少关联 ADR | 创建 ADR 或使用 skip_adr_check |
| C4A-STORE-003 | 422 | 实体被其他实体引用，无法删除 | 先删除引用关系或使用 force=true |
| C4A-STORE-004 | 422 | 实体正在被 feat 修改，无法删除 | 等待相关 feat 发布或废弃 |
| **PERM 类（权限错误）** ||||
| C4A-PERM-001 | 403 | 无写权限 | 联系项目管理员授权 |
| C4A-PERM-002 | 403 | 无批准权限 | 联系项目负责人批准 |
| C4A-PERM-003 | 403 | 无读权限 | 联系项目管理员授权 |
| C4A-PERM-004 | 401 | 认证失败 | 检查 Token 或凭证 |
| C4A-PERM-005 | 403 | 跨项目操作权限不足 | 需要目标项目的写权限 |
| **MIGRATE 类（数据迁移错误）** ||||
| C4A-MIGRATE-001 | 422 | 缺少 source_project 字段 | 指定实体归属的项目 |
| C4A-MIGRATE-002 | 422 | 缺少 source_repo 字段 | 指定实体归属的代码仓库 |
| C4A-MIGRATE-003 | 422 | source_project 格式不正确 | 只能包含小写字母、数字和连字符 |
| C4A-MIGRATE-004 | 422 | source_repo 格式建议改进 | 建议格式为 owner/repo |
| C4A-MIGRATE-005 | 422 | Domain/Enterprise 层级不应有 source_project | 删除 source_project 字段 |
| C4A-MIGRATE-006 | 422 | Domain/Enterprise 层级不应有 source_repo | 删除 source_repo 字段 |
| C4A-MIGRATE-007 | 422 | external 实体不应有 source_project | 删除 source_project 字段 |
| C4A-MIGRATE-008 | 422 | external 实体缺少 external_url | 添加外部系统的 URL |

### 3.3 错误响应格式

```typescript
interface ErrorResponse {
  code: string;           // 错误码，如 "C4A-DATA-001"
  message: string;        // 错误消息（用户友好）
  details?: {             // 详细信息（可选）
    field?: string;       // 出错字段
    expected?: string;    // 期望值
    actual?: string;      // 实际值
    suggestion?: string;  // 修复建议
  };
  timestamp: string;      // 错误发生时间
  request_id?: string;    // 请求 ID（用于追踪）
  recoverable_actions?: RecoverableAction[];
}

interface RecoverableAction {
  action: string;         // 操作标识，如 "retry", "force", "skip"
  label: string;          // 操作描述
  params?: object;        // 重试时需要的参数
}
```

**示例**：

```json
{
  "code": "C4A-DATA-001",
  "message": "引用的实体不存在",
  "details": {
    "field": "container_id",
    "expected": "有效的 Container ID",
    "actual": "payment-service",
    "suggestion": "检查 ID 拼写或先创建该 Container"
  },
  "timestamp": "2026-01-22T10:30:00Z",
  "request_id": "req-abc123"
}
```

### 3.4 多语言错误消息

错误消息支持多语言，通过 `Accept-Language` 头或配置指定：

```typescript
const errorMessages: Record<string, Record<string, string>> = {
  "C4A-DATA-001": {
    "zh": "引用的实体不存在",
    "en": "Referenced entity not found"
  },
  "C4A-PERM-001": {
    "zh": "无写权限",
    "en": "No write permission"
  },
  // ... 其他错误码
};

function getErrorMessage(code: string, lang: string = "zh"): string {
  return errorMessages[code]?.[lang] || errorMessages[code]?.["en"] || code;
}
```

---

## 4. 最佳实践

### 4.1 错误处理

1. **提前检查**：在执行操作前检查前置条件
2. **原子操作**：使用事务保证操作的原子性
3. **详细日志**：记录足够的上下文信息
4. **用户友好**：错误信息使用自然语言，避免技术术语
5. **提供建议**：告诉用户如何解决问题

### 4.2 权限控制

1. **最小权限原则**：只授予必要的权限
2. **定期审计**：定期检查权限配置
3. **权限分离**：读写权限分离，批准权限独立
4. **审计日志**：记录所有权限检查结果
5. **集成外部系统**：支持 LDAP、OAuth 等企业权限系统

### 4.3 恢复机制

1. **定期备份**：每天自动备份数据
2. **操作日志**：记录所有关键操作
3. **回滚支持**：支持关键操作的回滚
4. **测试恢复**：定期测试备份恢复流程
5. **监控告警**：监控系统状态，及时发现问题

---

## 5. 输入验证与输出安全

### 5.1 DSL 注入风险

DSL 文本字段（如 `description`、`notes`）可包含任意文本，存在注入风险：

```yaml
# 恶意输入示例
data:
  description: |
    正常描述内容
    <script>alert('xss')</script>
    ![image](javascript:alert('xss'))
```

### 5.2 安全策略

**输入阶段**（写入时）：

| 策略 | 说明 | 实现 |
|------|------|------|
| **不过滤原始内容** | DSL 作为源数据，保留原始内容 | 存储时不做内容过滤 |
| **Schema 验证** | 验证字段类型和格式 | 通过 JSON Schema 验证 |
| **长度限制** | 防止超大内容攻击 | 各字段设置 maxLength |

**输出阶段**（渲染/导出时）：

| 场景 | 策略 | 实现 |
|------|------|------|
| **可视化渲染** | HTML 转义 | 所有文本字段使用 `escapeHtml()` |
| **Markdown 导出** | 保留原文 | Markdown 本身不执行脚本 |
| **JSON API 响应** | 原样输出 | 由前端负责转义 |
| **Mermaid 图表** | 字符串转义 | 特殊字符转义（引号、括号等） |

### 5.3 实现规范

**HTML 转义函数**：

```typescript
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}
```

**Mermaid 字符串转义**：

```typescript
function escapeMermaidString(text: string): string {
  // Mermaid 节点标签中的特殊字符需要转义
  return text
    .replace(/"/g, '#quot;')
    .replace(/\[/g, '#91;')
    .replace(/\]/g, '#93;')
    .replace(/\(/g, '#40;')
    .replace(/\)/g, '#41;');
}
```

**可视化工具输出规范**：

```typescript
// c4a_visual_render 渲染时自动转义
interface RenderOptions {
  escape_html?: boolean;  // 默认 true
}

// 示例：渲染 C4 图表时转义描述文本
function renderC4Diagram(entities: Entity[]): string {
  return entities.map(e => {
    const safeDesc = escapeHtml(e.data.description || '');
    return `System(${e.id}, "${e.data.name}", "${safeDesc}")`;
  }).join('\n');
}
```

### 5.4 安全责任划分

| 层级 | 责任 | 说明 |
|------|------|------|
| **存储层** | 保留原始数据 | 不做内容过滤，保持数据完整性 |
| **MCP 工具层** | Schema 验证 | 验证字段类型、格式、长度 |
| **可视化层** | 输出转义 | 所有渲染输出必须转义 |
| **前端/CLI** | 显示转义 | 展示用户输入时转义 |

> **原则**：存储原始数据，输出时转义。这样既保证数据完整性，又防止注入攻击。

### 5.5 路径安全校验（Path Traversal 防护）

涉及文件系统路径的工具（如 `c4a_store_sync`、`c4a_store_backup`）必须进行路径安全校验：

**风险场景**：

```typescript
// 恶意输入示例
c4a_store_sync({
  direction: "export",
  path: "../../etc/passwd"  // 尝试访问项目外文件
})

c4a_store_backup({
  output: "/etc/cron.d/malicious"  // 尝试写入系统目录
})
```

**校验规则**：

| 规则 | 说明 | 错误码 |
|------|------|--------|
| **禁止父目录引用** | 路径不能包含 `..` | C4A-INPUT-007 |
| **禁止绝对路径** | 路径必须是相对路径 | C4A-INPUT-007 |
| **限制在项目根目录内** | 解析后的路径必须在 `PROJECT_ROOT` 下 | C4A-INPUT-006 |
| **禁止符号链接逃逸** | 解析符号链接后仍需在项目内 | C4A-INPUT-006 |

**TOCTOU 漏洞防护**：

> **问题**：路径校验（check）和文件操作（use）之间存在时间差，攻击者可能在此期间替换符号链接指向。

**防护策略**：

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| **O_NOFOLLOW** | 打开文件时不跟随符号链接 | 读取文件 |
| **原子操作** | 使用 `openat()` 系列函数 | 写入文件 |
| **目录锁定** | 先打开目录句柄，再相对操作 | 批量文件操作 |

**实现规范**：

```typescript
import { resolve, relative, isAbsolute } from 'node:path';
import { realpath, open, constants } from 'node:fs/promises';

async function validatePath(
  inputPath: string,
  projectRoot: string
): Promise<{ valid: boolean; error?: string }> {
  // 1. 禁止绝对路径
  if (isAbsolute(inputPath)) {
    return { valid: false, error: 'C4A-INPUT-007: 不允许绝对路径' };
  }

  // 2. 禁止父目录引用
  if (inputPath.includes('..')) {
    return { valid: false, error: 'C4A-INPUT-007: 不允许父目录引用 (..)' };
  }

  // 3. 解析并检查是否在项目根目录内
  const resolvedPath = resolve(projectRoot, inputPath);
  const relativePath = relative(projectRoot, resolvedPath);

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return { valid: false, error: 'C4A-INPUT-006: 路径必须在项目根目录内' };
  }

  // 4. 检查符号链接（如果路径存在）
  try {
    const realPath = await realpath(resolvedPath);
    const realRelative = relative(projectRoot, realPath);
    if (realRelative.startsWith('..') || isAbsolute(realRelative)) {
      return { valid: false, error: 'C4A-INPUT-006: 符号链接指向项目外' };
    }
  } catch {
    // 路径不存在时跳过符号链接检查（创建新文件场景）
  }

  return { valid: true };
}

// TOCTOU 安全的文件读取
async function safeReadFile(
  inputPath: string,
  projectRoot: string
): Promise<Buffer> {
  // 1. 先验证路径
  const validation = await validatePath(inputPath, projectRoot);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const resolvedPath = resolve(projectRoot, inputPath);

  // 2. 使用 O_NOFOLLOW 打开文件（不跟随符号链接）
  // 注意：Node.js 不直接支持 O_NOFOLLOW，需要在打开后再次验证
  const fd = await open(resolvedPath, constants.O_RDONLY);

  try {
    // 3. 打开后再次验证真实路径（防止 TOCTOU）
    const fdPath = await realpath(`/proc/self/fd/${fd.fd}`);
    const fdRelative = relative(projectRoot, fdPath);

    if (fdRelative.startsWith('..') || isAbsolute(fdRelative)) {
      throw new Error('C4A-INPUT-006: 检测到路径逃逸攻击');
    }

    return await fd.readFile();
  } finally {
    await fd.close();
  }
}
```

**适用工具**：

| 工具 | 涉及路径参数 | 校验时机 |
|------|-------------|---------|
| `c4a_store_sync` | `path` | 执行前 |
| `c4a_store_backup` | `output` | 执行前 |
| `c4a_store_restore` | `input` | 执行前 |
| `c4a_store_plan_sync` | `local_manifest.files[].path` | 执行前 |

---

## 6. 未来优化方向

### 6.1 短期（v0.3.x）

- [ ] 完善错误码体系
- [ ] 增加更多恢复场景
- [ ] 优化错误提示信息

### 6.2 长期（v0.4.0+）

- [ ] 支持细粒度权限控制（字段级）
- [ ] 实现分布式事务
- [ ] 支持多租户权限隔离
- [ ] 增加权限可视化管理界面

---

## 附录：错误处理流程图

```
操作请求
  ↓
前置条件检查
  ↓ 失败
提示用户 + 提供修复建议
  ↓ 通过
权限检查
  ↓ 失败
提示权限不足 + 联系管理员
  ↓ 通过
开启事务
  ↓
执行操作
  ↓ 失败
回滚事务 + 记录错误日志 + 提示用户
  ↓ 成功
提交事务 + 记录操作日志
  ↓
返回结果
```
