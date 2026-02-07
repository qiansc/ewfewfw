# 状态流转

## 当前工作上下文

{{#if current_feat_uuid}}
**当前 Feature**: `{{current_feat_uuid}}`
**Feature 状态**: `{{current_feat_status}}`

⚠️ 一致性检查等工具调用必须携带 `requirement_id: "{{current_feat_uuid}}"`。
{{else}}
**当前 Feature**: 无（主分支模式）
{{/if}}

## 工具调用规则

- `c4a_store_validate` 必须传递 `requirement_id`
- `c4a_store_feat_lifecycle` 使用 `feat_id` 进行状态流转

## 状态机

```
draft ──批准──► approved ──发布──► published
                   │
              (可回退到 draft 修改)
```

## 命令格式

```
/c4a:feat --status=approved   # draft → approved
/c4a:feat --status=published  # approved → published
```

## 流转规则

| 目标状态 | 前置状态 | 说明 |
|----------|----------|------|
| approved | draft | 批准方案，允许开始实现 |
| published | approved | 发布，合并到主分支 |

**约束**：
- `--status=approved`：仅接受 `draft` 状态
- `--status=published`：仅接受 `approved` 状态

---

## 批准方案 (draft → approved)

### 触发条件

- 用户说"批准方案"
- 用户说"方案 OK"
- `/c4a:feat --status=approved`

### 工具编排

```
1. 检查当前状态是否为 draft
2. 调用 c4a_store_feat_lifecycle:
   c4a_store_feat_lifecycle({
     action: "transition",
     feat_id: "<current-feat-id>",
     to_status: "approved"
   })
3. 展示结果
```

### 输出格式

```
✅ 方案已批准

📋 Feature: {feat-id}
📄 状态：draft → approved

💡 下一步建议：
- /c4a:implement - 开始实现
- /c4a:feat --status=published - 直接发布（纯知识类型）
```

---

## 发布 (approved → published)

### 触发条件

- 用户说"发布"
- `/c4a:feat --status=published`

### 前置条件

- 状态必须为 `approved`
- 如果是 `draft`，报错并提示先批准

### 工具编排

```
1. 状态检查：
   - 如果是 draft：
     ❌ "请先执行 /c4a:feat --status=approved 批准方案"
   - 如果是 approved，继续

2. 一致性检查（内部调用 /c4a:analyze）：
   c4a_store_validate({
     requirement_id: "<current-feat-id>",
     checks: ["functional_spec", "technical_spec", "contracts", "references", "adr_completeness", "checklist"]
   })

3. 发布前同步：
   - 计算本地 content_hash
   - 执行 `c4a sync` 确保本地修改已上传

4. 如有问题，展示并询问处理方式：
   - 修复问题后再发布
   - 忽略警告，继续发布
   - 取消发布

5. 执行发布（含自动合并）：
   c4a_store_feat_lifecycle({
     action: "transition",
     feat_id: "<current-feat-id>",
     to_status: "published",
     expected_content_hash: "<local-hash>"
   })

   工具内部：
   - 校验 content_hash
   - 自动调用 c4a_store_feat_merge(strategy="auto")
   - 合并成功后流转状态
   - 清理远程 checklist

6. 如有合并冲突，展示并询问处理方式

7. 提示同步：建议执行 c4a sync
```

### 输出格式

**无冲突**:
```
🔍 一致性检查中...

✅ Functional Spec 完整
✅ Technical Spec 完整
✅ 契约完备
✅ DSL 引用正确

📤 正在发布...
✅ 合并成功：{entity-1}, {entity-2}
✅ 状态流转：approved → published

💡 建议执行 c4a sync 同步到知识库
```

**有冲突**:
```
🔍 一致性检查中...

✅ 检查通过

📤 正在发布...
⚠️ 检测到合并冲突：

1. {entity-id}
   - 冲突类型：{内容冲突|删除冲突}
   - 主分支版本：{summary}
   - feat 版本：{summary}
   - 建议：{recommendation}

? 如何处理冲突？
  > 保留 feat 版本（推荐）
    保留主分支版本
    取消发布，手动解决
```

### 冲突解决

用户选择后，调用：

```
c4a_store_feat_merge({
  feat_id: "<current-feat-id>",
  conflict_resolution: [
    { entity_id: "<id>", resolution: "keep_feat" | "keep_main" }
  ]
})
```

然后重新执行发布流程。

---

## 错误处理

| 场景 | 处理 |
|------|------|
| draft 直接发布 | 报错，提示先批准 |
| 一致性检查失败 | 展示问题，询问处理方式 |
| content_hash 不一致 | 提示先同步本地修改 |
| 合并冲突 | 展示冲突，询问解决方式 |
| 网络/事务失败 | 提示使用 `c4a feat repair` 修复 |

## 原子性保证

`c4a_store_feat_lifecycle` 内部使用数据库事务确保：
- 状态流转
- 合并操作
- Checklist 清理

三者的原子性。任一步骤失败，整个操作回滚。
