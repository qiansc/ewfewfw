# Issue Codex - 文档与实现不一致清单

## `v0.3.0/architecture.md`
- §1.1/§6 服务端口：文档写 `storage-backend` 为 8050（且 MCP 端口固定），但实际 `docker/docker-compose.server.yml` 暴露为 8055，`packages/cli/src/commands/install.ts` 也写死 8055。影响：按文档配置将无法连通服务端。建议：统一端口并同步文档/代码。
- §1.1/§1.4 MCP 服务构成：文档包含 `c4a-visual-mcp`（以及 Data MCP 应含 query/visual），但 `docker/docker-compose.server.yml` 仅启动 store/query，缺少 visual；同时 `packages/cli/src/commands/init.ts` 在 remote 模式只写入 store MCP，缺少 query/visual/extract。影响：可视化/查询/提取能力在 Server/Remote 场景不可用或不可配置。建议：补齐服务与配置或调整文档。
- §2.2 工作目录结构：文档要求 `.context/.schemas/`、`assets/`、`technical/contracts/` 等目录，但 `packages/cli/src/commands/init.ts` 仅创建业务/技术基础目录。影响：文档承诺的离线 Schema、合同与资产目录缺失。建议：补齐初始化目录或更新文档。
- §2.3 项目配置：文档示例包含 `server.url`；但 `c4a init` 未写入 server 配置，`packages/storage/src/get-adapter.ts` 在 server 模式强依赖 `server.url`。影响：server 模式初始化后直接调用存储将报错。建议：在 init 中补充 `server.url` 或调整 adapter 容错。
- §2.7 Schema 校验：文档要求 `schema: c4a/v1` + `type: software-system` + 嵌套 `system/container/...`；但 `packages/cli/src/core/templates.ts` 生成的模板为扁平 `type/id/data/metadata`，且未包含 schema 声明，与 `packages/core/src/schemas/*` 不匹配。影响：`c4a validate`/`c4a_store_save` 对模板文件会失败。建议：统一 DSL 格式或调整模板与校验。

## `v0.3.0/concepts.md`
- §3 知识生命周期强制规则：文档要求状态流转不可跳跃且 published 不可直接修改；但 `packages/storage/src/lite-adapter/crud-save.ts` 与 `packages/storage-backend/src/routes/entities.py` 未实现状态机校验，且主分支默认直接写入 `published`。影响：生命周期规则形同虚设，发布态可被直接覆盖。建议：在 save/transition 层加入状态机校验。
- §3 变更历史：文档强调 `c4a_store_read_history` 可追溯历史；`packages/storage-backend/src/routes/entities.py` 的 `/entities/read-history` 返回空数组。影响：Server/Remote 模式无法追溯历史。建议：实现历史记录读取或调整文档范围。
- §7 知识追溯链/关系：文档要求保存时自动写入 `CONTAINS/REFERENCES/CORRESPONDS` 等关系；但 `packages/storage-backend/src/routes/entities.py` 未解析 DSL 也未写 relations/neo4j 关系。影响：Server/Remote 的 deps/impact 查询不完整。建议：在服务端补关系解析与写入。

## `v0.3.0/product.md`
- §3.6 代码关联、§3.7 可视化：文档列为核心能力，但 Server 模式 `docker/docker-compose.server.yml` 未部署 `c4a-visual-mcp`，且 `c4a init` 未配置 extract MCP（任一模式）。影响：产品承诺的代码关联/可视化在实际安装流程中无法使用。建议：补齐服务/配置或降低承诺。

## `v0.3.0/detailed-design/cli/user-cli.md`
- §2.4 `c4a init` 输出文件：文档要求 `.mcp.json` + `.claude/settings.local.json`，但 `packages/cli/src/commands/init.ts` 写入的是 `claude.json`，且未生成 `.claude/settings.local.json`。影响：Claude Code 侧配置不符合文档指引。建议：统一配置文件名与路径。
- §2.5 项目配置：文档包含 `server.url`；`c4a init` 不会写入 server 配置。影响：server 模式下存储适配器无法初始化。建议：补写配置或调整文档。
- §2.1/2.2 首次初始化目录：文档要求 `.context/.schemas` 等目录，但 init 未创建。影响：离线 Schema 回退路径缺失。建议：补齐目录或更新文档。

## `v0.3.0/detailed-design/cli/mcp-mapping.md`
- §4.1/§4.2 Server/Remote 通过 HTTP 调用 MCP：文档约定 Server/Remote 使用 HTTP MCP；但 `packages/cli/src/commands/sync.ts` 与 `packages/cli/src/commands/status.ts` 在 server 模式使用 `stdio`，`packages/cli/src/core/mcp-client.ts` 也只解析 mcp-store 入口。影响：Server 模式下 MCP 调用路径与文档不一致，且 query/visual 未被使用。建议：统一传输方式或修订文档。
- §4.2 `c4a sync` 依赖 `c4a_store_plan_sync`：CLI 预期 `PlanSyncResult`（含 actions/new_snapshot），但 `packages/storage-backend/src/routes/sync.py` 的 `/sync/plan` 返回结构为 `plan`，不含 `actions`/`new_snapshot`/`execute`。影响：Server/Remote 同步流程不可用。建议：统一协议并实现 execute 流程。

## `v0.3.0/detailed-design/mcp/overview.md`
- §1.2 工具可见性：文档声明 `c4a_store_backup/restore` 为 CLI 内部工具且不对 Agent 暴露，但 `packages/mcp-store/src/server.ts` 仍注册并公开这些工具。影响：工具可见性分层失效。建议：在 MCP Server 侧做暴露控制或更新文档。

## `v0.3.0/detailed-design/mcp/store-crud.md`
- §3.1 `c4a_store_save` 的 `data`/`content` 互斥规则未生效：`packages/storage/src/lite-adapter/crud-save.ts` 与 `packages/storage-backend/src/routes/entities.py` 只优先读取 `data`，不对双传入报错。影响：文档约束失效。建议：增加参数校验。
- §3.1 `id` 可省略自动生成：本地与服务端都要求 `id`（`Entity ID is required`），无自动生成逻辑。影响：文档承诺不可用。建议：补充 ID 生成或修订文档。
- §3.1 ADR 策略：文档说明应读取项目 `adr_policy`；`c4a_store_save` 仅使用参数 `enforce_adr/skip_adr_check`，未读取 `.context/.c4a.yaml`。影响：策略配置无效。建议：在 save 层加载项目配置。
- §3.1 保存时自动写关系：Local 模式已实现解析，但 Server 模式保存不写关系/引用解析。影响：Server/Remote 中关系缺失。建议：在 storage-backend 加入关系解析逻辑。
- §3.4 删除规则：文档要求 feat 内删除主分支实体时软删除（archived）；`packages/storage-backend/src/routes/entities.py` 直接硬删除。影响：feat 删除语义偏离设计。建议：补软删除逻辑。

## `v0.3.0/detailed-design/mcp/store-sync.md`
- §3.5/§3.5.1 同步计划：文档要求 `execute=true` 返回 `actions/new_snapshot`，并支持下载/删除/冲突；`packages/storage-backend/src/routes/sync.py` 的 `plan_sync` 只计算上传/冲突且无执行逻辑。影响：Server/Remote 同步无法完成。建议：补充计划执行与三方对比。
- §3.5.1 Double Check：文档要求 CLI 侧文件指纹复核，`packages/cli/src/commands/sync.ts` 未实现指纹校验。影响：同步窗口期数据可能被覆盖。建议：实现指纹/哈希复核。

## `v0.3.0/detailed-design/mcp/store-feat-lifecycle.md`
- §3.6/§3.7 Feat 生命周期与合并：`packages/storage-backend/src/routes/feat.py` 的 `feat_merge` 直接返回空结果，`feat_lifecycle` 未做流转合法性校验或实体状态联动。影响：feat 发布/合并设计不可用。建议：实现生命周期与合并逻辑。

## `v0.3.0/detailed-design/mcp/store-feat-checklist.md`
- §3.8 Checklist 结构与渲染：文档示例按阶段 `phases` 组织；实际 schema 为 `items`（`packages/core/src/schemas/c4a-checklist.schema.json`），`packages/cli/src/core/checklistRender.ts` 也按 items 渲染。影响：文档与实际结构不一致。建议：统一文档/实现的数据结构。
- §3.8.1 本地文件保护机制：文档描述指纹校验/阻断，但 `c4a feat render` 仅写文件，无保护实现。影响：只读视图容易被误改。建议：实现指纹校验或更新文档。

## `v0.3.0/detailed-design/mcp/store-utils.md`
- §3.11 `c4a_store_read_history`：Server 端 `/entities/read-history` 返回空数组。影响：Server/Remote 无历史追溯能力。建议：实现读历史接口或调整文档承诺。

## `v0.3.0/detailed-design/mcp/query.md`
- §4.4 Server 降级检测：文档要求一致性状态检测与降级提示，但 `packages/mcp-query/src/checkSyncStatus.ts` 默认不检测（需外部注入）。影响：Server 模式不会自动标记降级。建议：在查询侧接入一致性检测。

## `v0.3.0/detailed-design/mcp/visual.md`
- §5.3 内部工具不暴露：文档声明模板/存储/清理等为内部工具，但 `packages/mcp-visual/src/server.ts` 全部注册为 MCP 工具。影响：工具可见性与文档不一致。建议：按可见性分层控制暴露。

## `v0.3.0/detailed-design/permissions/cross-project-auth.md`
- §1.4/§1.7 权限检查时机：文档要求 feat 发布与跨项目权限检查；`packages/storage-backend/src/routes/feat.py` 未做权限校验或跨项目校验。影响：跨项目发布权限规则未生效。建议：在 feat 生命周期加入权限检查。
- §1.7.1 MCP 工具层权限检查：`packages/storage-backend/src/middleware/permission_check.py` 为空文件，权限逻辑未集中在 MCP 层。影响：权限检查与文档职责划分不一致。建议：补齐中间件或更新文档。

## `v0.3.0/detailed-design/data-ops/sync-export.md`
- §2.3/§2.5 内容哈希口径：文档要求基于“解析后的 DSL 对象 + 排除 created_at/updated_at 等字段”的统一哈希；CLI 在 `packages/cli/src/commands/sync.ts` 使用 `calculateHash(content)` 对原始文本计算哈希，且未剔除字段（见 `packages/cli/src/utils/hash.ts`），与存储侧 `packages/storage/src/utils/contentHash.ts` 的口径不一致。影响：Server/Remote `c4a_store_plan_sync` 的冲突检测可能出现误判或漏判。建议：统一 CLI/存储的 hash 计算逻辑。

## `v0.3.0/detailed-design/data-ops/cross-reference.md`
- §1.11 悬空引用自动解析：文档要求保存或批量导入后自动解析悬空引用并更新 resolved/resolve_status；当前仅在 `packages/storage/src/lite-adapter/relations.ts` 写入时标记 resolved/pending，缺少全量解析与回填的实现（无对应批处理/修复逻辑）。影响：已创建的目标实体不会自动“解悬空”，引用长期保持未解析状态。建议：补充批量解析与回填流程。

## `v0.3.0/detailed-design/data-ops/conflict-rollback.md`
- §3.4/§3.5 Feat 冲突检测与合并：文档要求 `c4a_store_feat_merge` 返回冲突并执行自动合并；Server 端 `packages/storage-backend/src/routes/feat.py` 的 `feat_merge` 直接返回空 conflicts。影响：冲突检测/合并不可用。建议：实现合并策略与冲突输出或调整文档范围。

## `v0.3.0/detailed-design/data-ops/cross-project-transaction.md`
- §6.4 后台重试任务：文档要求后台定时重试 Neo4j/Milvus 同步并更新 `sync_status`；当前服务端仅在保存时写入 pending（`packages/storage-backend/src/routes/entities.py`），未见定时任务或队列实现。影响：派生数据可能长期处于 pending/failed，需人工修复。建议：补充后台重试或明确仅提供手动修复。

## `v0.3.0/detailed-design/data-ops/workflow-recovery.md`
- §2/§4 Workflow 状态存储与恢复：文档要求 `workflow_states` 表 + `workflow_steps` 列表结构，并支持断点恢复；Server 端 `packages/storage-backend/src/routes/feat.py` 仅维护 `workflow_steps` 字典且无 workflow_states 记录与恢复逻辑。影响：跨机器恢复与步骤级审计不符合设计。建议：按文档统一结构与恢复流程。

## `v0.3.0/detailed-design/permissions/error-codes.md`
- §3.3 MCP 错误响应格式：文档要求标准化 ErrorResponse；Server 端多个接口返回 `{success:false, error:"..."}` 或 HTTPException.detail 的简化结构（如 `packages/storage-backend/src/routes/feat.py`）。影响：Agent/CLI 无法稳定解析错误。建议：统一错误响应结构或调整文档。
- §5.5 路径安全校验：文档要求对 sync/backup/restore/plan_sync 路径进行 traversal 校验；Server 端 `packages/storage-backend/src/routes/utils.py` 直接读写 `output/input` 路径，未见路径校验逻辑。影响：存在潜在路径逃逸风险。建议：加入统一路径校验或限制输出目录。
