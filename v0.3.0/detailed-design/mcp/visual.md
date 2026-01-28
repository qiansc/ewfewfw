# 可视化：`c4a_visual_*`（c4a-visual-mcp）

> **v0.3.0 实现说明**：本期可视化工具**暂不实现**，保留设计文档供后续版本参考。
>
> - 现有 `c4a_visual_*` 代码保持编译通过即可，不主动引用
> - 核心工作流（feat → specify → plan → implement）不依赖可视化工具
> - 后续版本按需实现

## 5.1 `c4a_visual_generate`（AI 生成图片）

**设计目的**：使用 AI 模型生成图片，支持架构图、流程图、概念图等多种场景。

**输入（概念签名）**：

```typescript
c4a_visual_generate({
  prompt: string;              // 图片描述提示词
  aspect_ratio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";  // 宽高比，默认 "16:9"
  size?: "1K" | "2K" | "4K";   // 分辨率，默认 "2K"
  format?: "PNG" | "JPEG";     // 输出格式，默认 "PNG"
  filename?: string;           // 自定义文件名
  storage_mode?: "cache" | "permanent" | "report";  // 存储模式，默认 "cache"
  report_id?: string;          // 报告 ID（storage_mode 为 report 时必需）
})
```

**返回（概念示例）**：

```typescript
{
  success: true,
  image_id: "img-abc123",
  path: ".context/cache/images/img-abc123.png",
  format: "PNG",
  size: "2K",
  aspect_ratio: "16:9",
  storage_mode: "cache",
  metadata: {
    prompt: "...",
    generated_at: "2026-01-25T10:00:00Z"
  }
}
```

**存储模式说明**：

| 模式 | 存储位置 | 生命周期 | 适用场景 |
|------|---------|---------|---------|
| `cache` | `.context/cache/images/` | 临时，定期清理 | 临时预览、调试 |
| `permanent` | `.context/images/` | 永久 | 需要版本控制的图片 |
| `report` | `.context/reports/{report_id}/images/` | 随报告 | 报告内嵌图片 |

---

## 5.2 `c4a_visual_render_c4`（C4 架构图生成）

**设计目的**：从数据库查询架构数据，自动生成 C4 模型图（系统上下文图、容器图、组件图）。

**输入（概念签名）**：

```typescript
c4a_visual_render_c4({
  level: "context" | "container" | "component";  // C4 层级
  entity_id?: string;          // 聚焦的实体 ID（可选）
  theme?: "default" | "dark" | "forest" | "neutral";  // 主题，默认 "default"
  output_format?: "svg" | "png";  // 输出格式，默认 "svg"
  filename?: string;           // 自定义文件名
  storage_mode?: "cache" | "permanent" | "report";  // 存储模式，默认 "cache"
  report_id?: string;          // 报告 ID（storage_mode 为 report 时必需）
})
```

**返回（概念示例）**：

```typescript
{
  success: true,
  image_id: "c4-container-abc123",
  path: ".context/cache/images/c4-container-abc123.svg",
  format: "svg",
  level: "container",
  entities_count: 5,
  relationships_count: 8,
  mermaid_code: "C4Container\n  ..."  // 生成的 Mermaid 代码（便于调试）
}
```

**层级说明**：

| 层级 | 展示内容 | 数据来源 |
|------|---------|---------|
| `context` | System 及其与外部系统的关系 | `type: system` 实体 |
| `container` | System 内的 Container 及其关系 | `type: container` 实体 |
| `component` | Container 内的 Component 及其关系 | `type: component` 实体 |

**实现说明**：

1. 从 Neo4j 查询指定层级的实体和关系
2. 生成 Mermaid C4 语法代码
3. 调用 Mermaid CLI 渲染为 SVG/PNG
4. 保存到指定存储位置

---

## 5.3 已移除的工具

以下工具在 v0.3.0 中不作为独立 MCP 工具暴露，相关功能由 CLI 内部实现或后续版本按需添加：

| 原工具 | 处理方式 | 说明 |
|--------|---------|------|
| `c4a_visual_render` | CLI 内部 | Mermaid 渲染作为 `render_c4` 的内部实现 |
| `c4a_visual_list_templates` | 移除 | 模板管理功能后续版本按需添加 |
| `c4a_visual_render_template` | 移除 | 模板管理功能后续版本按需添加 |
| `c4a_visual_save` | CLI 内部 | 图片保存作为 `generate`/`render_c4` 的内部实现 |
| `c4a_visual_get_reference` | CLI 内部 | 引用路径生成作为内部实现 |
| `c4a_visual_cleanup` | CLI 命令 | 通过 `c4a cache clean` 命令调用 |
| `c4a_visual_storage_stats` | CLI 命令 | 通过 `c4a status` 命令展示 |
| `c4a_visual_get_style` | 移除 | 风格配置功能后续版本按需添加 |
