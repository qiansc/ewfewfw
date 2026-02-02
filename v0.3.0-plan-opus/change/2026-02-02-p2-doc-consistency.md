# P2 文档一致性变更提案（2026-02-02）

> 说明：v0.3.0 设计文档冻结，先在此记录待更新点，待评审后统一修改。

## 待补充/修正项

1. **缺失表结构说明**
   - `feats` 表未在文档中说明
   - `workflow_states` / `compensation_logs` 表未在文档中说明
   - `entities` 表新增 `orphaned` / `orphaned_at` 字段未文档化

2. **同步与哈希口径**
   - `spec_uri` 同步范围描述在 `concepts.md` 与 `architecture.md` 不一致
   - `expected_content_hash` 计算口径未定义
   - `Checklist` 清理时机（published/archived）描述不一致

3. **引用/作用域语义**
   - `scope:project/` 与 `project:{project_id}/` 语义冲突
   - `feats.project_ids` 字段语义与格式未明确（JSON/CSV）

4. **数据结构描述不一致**
   - `data` 扁平化描述与 FTS 触发器实现不一致
   - `Checklist` 不参与同步导致多人协作可见性问题需明确策略

## 建议落地方式

- 在 `v0.3.0/detailed-design/` 内新增或补充对应章节，并在 `architecture.md` 中同步更新目录引用。
- 对涉及协议/字段的变更，补齐示例与校验规则（含数据迁移说明）。
