# ADR 草稿创建流程

## 1. 识别用户意图

根据输入智能路由：

| 输入 | 行为 |
|------|------|
| "help" / "帮助" / "?" | 显示功能介绍 |
| 无参数 | 开始创建 ADR 流程 |

**显示帮助（用户输入 help 时）：**
```
📖 /c4a/adr/draft 功能介绍

创建 ADR（架构决策记录）草稿的交互式流程：
  1. 检查调研文档 - 自动检测 .c4a/research/ 下的文档
  2. 收集 ADR 信息 - 对话式收集编号、标题、背景、决策等
  3. 影响分析 - 可选查询现有架构，分析潜在影响
  4. 范围检查 - 确保 ADR 聚焦决策，不含实现细节
  5. 生成 DSL 文件 - 自动生成 .c4a.yaml 格式文件
  6. 保存到草稿目录 - 写入 .c4a/drafts/<adr-id>/

用法：
  /c4a/adr/draft    开始创建流程

下一步：
  创建完成后使用 /c4a/adr/review <adr-id> 进行评审
```

## 2. 检查调研文档

- 使用 bash `ls .c4a/research/ 2>/dev/null` 列出文件
- 如果有文件，询问用户：
  ```
  检测到 N 个调研文档，是否参考？
    1. 参考全部（推荐）
    2. 选择部分
    3. 不参考
  ```
- 如果参考，使用 read 工具读取相关文档

## 3. 收集 ADR 信息（对话式交互）

- ADR 编号 (格式: adr-XXX，如 adr-001)
- 标题 (简短描述决策)
- 背景描述 (为什么需要这个决策)
- 决策内容 (我们决定做什么)
- 涉及的容器 (新增/修改哪些容器)

## 4. 范围检查（ADR 抽象度守护）

**重要**：ADR 是架构决策记录，应聚焦「决策」而非「实现」。

收集信息后，检查用户输入是否过于具体，以下内容**不应出现在 ADR 中**：

| 过于具体的内容 | 应该如何处理 |
|---------------|-------------|
| 具体的代码实现（函数名、类名） | 移除，这是实现阶段的事 |
| 详细的 API 设计（字段、参数） | 概括为「提供 xxx API」，细节放 Contract |
| 配置项、环境变量清单 | 移除，放入容器文档或 README |
| 部署步骤、运维命令 | 移除，放入 knowledge.how |
| 具体的依赖版本号 | 只保留主要技术选型（如 Python 3.11） |
| 详细的数据模型字段 | 概括为「存储 xxx 数据」，细节放 Schema |

**如果检测到过于具体的内容，提醒用户：**

```
⚠️ ADR 范围建议

检测到以下内容可能过于具体：
  - "createUser(name, email, password)" → 建议改为「提供用户注册 API」
  - "PORT=8080, DB_HOST=..." → 建议移除配置细节
  - "UserSchema { id, name, email, ... }" → 建议改为「存储用户信息」

ADR 应聚焦于：
  ✓ 为什么做这个决策（背景）
  ✓ 决定采用什么方案（决策）
  ✓ 这个决策影响什么（后果）

是否需要帮你精简？
  1. 是，自动精简（推荐）
  2. 保持原样
  3. 我自己修改
```

## 5. 影响分析（可选，需要数据库可用）

**时机**：收集完 ADR 信息后，如果数据库可用，主动提供影响分析。

**步骤**：
1. 从用户输入中提取关键词（技术选型、功能描述）
2. 调用 `c4a_db_search_semantic(query: <关键词>)` 查询相关实体
3. 如果 ADR 涉及修改现有容器，调用 `c4a_db_query_impact(entity_id: <容器id>)` 分析影响

**输出格式**：
```
📋 潜在影响分析

根据你的决策内容，查询到以下可能相关的现有架构：

🔍 相关容器：
  - c4a-data-mcp: 当前使用同步 HTTP，可能需要适配
  - c4a-code-mcp: 有数据依赖关系

🔗 依赖链：
  c4a-dsl-mcp → c4a-data-mcp → MongoDB
                            → Neo4j

是否将这些纳入 ADR 的影响分析（consequences）？
  1. 是，自动添加（推荐）
  2. 选择部分
  3. 跳过，我自己写
```

**降级处理**：如果数据库不可用，跳过此步骤，不阻塞流程。

## 6. 获取 Schema（生成前必须执行）

**重要**：生成 DSL 前，必须先获取 Schema 了解正确格式：

```
调用 c4a_dsl_schema(type: "adr") 获取 ADR Schema
调用 c4a_dsl_schema(type: "container") 获取 Container Schema（如有新容器）
```

## 7. 生成 DSL 文件

- 调用 c4a_dsl_generate(type: "adr", ...) 生成 ADR DSL
- 如有新容器，调用 c4a_dsl_generate(type: "container", ...) 生成容器 DSL
- 根据用户提供的信息，补充模板中的占位内容

## 8. 写入并验证（必须验证）

**重要**：写入时必须开启验证，确保 DSL 符合 Schema：

```
调用 c4a_local_write_file(
  path: ".c4a/drafts/<adr-id>/<adr-id>.c4a.yaml",
  content: <生成的内容>,
  validate: true  # 必须设置为 true
)
```

如果返回 `valid: false`，根据 `errors` 修正内容后重新写入，直到验证通过。

## 9. 输出结果

```
✅ ADR 草稿已创建

📁 创建的文件:
  .c4a/drafts/<adr-id>/
  ├── <adr-id>.c4a.yaml          # ADR 文件
  ├── containers/                 # 只放 type: container 的文件
  │   └── <container-id>.c4a.yaml
  └── components/                 # 只放 type: component 的文件
      └── <component-id>.c4a.yaml

📊 当前状态: draft

🔜 下一步操作:
  - /c4a/adr/review <adr-id>  # 开始评审
```

---

## 目录结构约束（重要）

**目录-类型必须一致**，否则验证会产生警告：

| 目录 | 只能放 | 说明 |
|------|--------|------|
| `containers/` | `type: container` | 容器定义 |
| `components/` | `type: component` | 组件定义 |
| `adr/` | `type: adr` | ADR 文件 |
| `systems/` | `type: software-system` | 系统定义 |
| `contracts/` | `type: contract` | 契约定义 |

**常见错误**：
- ❌ 在 `containers/` 下创建 `type: component` 的文件
- ❌ 组件和容器放在同一个目录
- ✅ 容器放 `containers/`，组件放 `components/`

---

## Schema 约束（必须遵守）

### ADR 格式要求

```yaml
schema: c4a/v1
type: adr

adr:
  id: ADR-001          # 必须是 ADR-XXX 格式（大写 ADR + 3-4 位数字）
  title: 决策标题
  status: draft
  date: 2026-01-07     # YYYY-MM-DD 格式
  authors: []
  reviewers: []

context: |
  背景描述...

decision: |
  决策内容...

consequences:
  positive:            # 必须是 string 数组
    - 正面影响1
    - 正面影响2
  negative:            # 必须是 string 数组
    - 负面影响1
  neutral:             # 必须是 string 数组
    - 中性影响1

affects:               # 可选，影响的架构元素
  - element_type: container  # 只允许: system, container, component
    element_id: xxx
    scope: 影响范围说明

alternatives:          # 必须是 object 数组，不是 string 数组
  - name: 方案名称
    description: 方案描述
    pros:              # 可选，string 数组
      - 优点1
    cons:              # 可选，string 数组
      - 缺点1
```

**常见错误**：
- ❌ `id: adr-001` → ✅ `id: ADR-001`（必须大写）
- ❌ `alternatives: ["方案1", "方案2"]` → ✅ `alternatives: [{name: "方案1", description: "..."}]`
- ❌ `neutral: "中性影响"` → ✅ `neutral: ["中性影响"]`（必须是数组）
- ❌ 添加 `references` 字段 → ✅ 使用 `knowledge.links` 或写在 context 中
- ❌ `element_type: infrastructure` → ✅ 只允许 `system`, `container`, `component`

### Container 格式要求

```yaml
schema: c4a/v1
type: container

container:
  id: my-container
  name: My Container
  description: |
    容器描述...
  technology:          # 必须是 object，不是数组
    language: TypeScript
    framework: Express
    runtime: Bun
    protocol: HTTP
  ports:               # 可选
    - port: 8080
      protocol: HTTP
      description: Main API

relationships: []      # 可选

knowledge:             # 可选，只允许以下字段
  responsibility: 职责说明（一句话）
  how:
    description: 使用说明
    components:      # 组件 ID 列表（字符串数组）
      - component-a
      - component-b
  interfaces:        # 关键接口
    - name: methodName
      description: 方法描述
  links:
    - type: repository
      url: ./packages/xxx
      description: 源代码
```

**禁止添加的字段**（不在 Schema 中）：
- ❌ `status` - 状态由文件所在目录决定
- ❌ `external` - 仅当确实是外部系统时才添加
- ❌ `knowledge.what` / `knowledge.why` - 决策信息放 ADR
- ❌ `knowledge.components` 写成对象数组 → ✅ 必须是字符串数组
- ❌ `data_flows` - 使用 relationships 表达
- ❌ `platforms` - 放入 knowledge 或 README
- ❌ `core_modules` - 由代码分析自动生成

**常见错误**：
- ❌ `technology: ["Node.js", "Express"]` → ✅ `technology: {language: "Node.js", framework: "Express", ...}`
- ❌ `components: [{id: "xxx", source: "..."}]` → ✅ `components: ["xxx", "yyy"]`（必须是字符串数组）
