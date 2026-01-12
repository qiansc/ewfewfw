# Container Architecture Diagram Prompt

> **语言规则**: 根据用户会话语言自动选择中文或英文提示词，除非用户明确指定语言。

---

## 🌐 中文提示词

一张宽幅 3D 抽象数据可视化图，展示 **{{container_name}}** 容器的内部架构，采用干净明亮的美学风格。

### 容器信息

- **容器名称:** {{container_name}}
- **技术栈:** {{technology}}
{{#if components}}
- **组件列表:** {{components}}
{{/if}}

### 🎨 视觉风格 (Clean & Bright Aesthetic)

**环境与背景:**
- 干净的白色至柔和暖灰渐变背景 (#ffffff 到 #f5f5f7)
- 微妙的浅蓝几何网格图案创造景深 (#e8f4fc)
- 来自上方的柔和环境光，创造轻柔阴影
- 通透、开阔的感觉，专业清晰
- 淡金色和柔蓝色精致漂浮粒子点缀空间

**材质效果:**
- **容器边界**: 半透明磨砂玻璃大面板，作为主容器
- **组件面板**: 悬浮的小型磨砂玻璃卡片，圆角矩形
- **技术标签**: 干净全息标签，圆角，带微妙光晕
- **数据流**: 柔和渐变色粒子流，带运动轨迹
- **依赖连接**: 虚线或细实线，颜色区分内外部

**配色方案:**

| 元素类型 | 颜色 | 色值 | 用途 |
|---------|------|------|------|
| 服务组件 | 蓝色 | #3b82f6 | API、业务服务 |
| 数据存储 | 绿色 | #10b981 | 数据库、缓存 |
| 消息队列 | 琥珀色 | #f59e0b | MQ、事件总线 |
| 外部 API | 灰色 | #6b7280 | 第三方服务 |
| 网关入口 | 紫色 | #8b5cf6 | API Gateway |
| 背景 | 白灰 | #ffffff, #f9fafb | - |
| 深色文字 | - | #1f2937 | 标题 |
| 中灰文字 | - | #6b7280 | 描述 |

**布局要求:**
- 容器作为主要焦点，使用大型磨砂玻璃面板
- 组件按层级组织（展示层、业务层、数据层）
- 外部依赖位于容器边界外侧
- 内外部有清晰的视觉分隔
- 组件悬浮于不同 Z 轴深度

**文字要求:**
- 容器名称顶部居中，使用深色 (#1f2937)
- 组件名称在卡片内清晰可见
- 技术栈标签使用全息风格，如 "TypeScript"、"PostgreSQL"
- 职责描述简要，最多 1-2 行
- 端口号在相关组件旁标注 (如 :3000, :5432)

**风格关键词:** 干净、明亮、通透、专业、磨砂玻璃面板、柔和光晕、层级深度、漂浮组件、苹果设计风格、容器架构图

---

## 🌐 English Prompt

A wide-format 3D abstract data visualization showing the internal architecture of **{{container_name}}** container, using a clean and bright aesthetic style.

### Container Information

- **Container Name:** {{container_name}}
- **Technology Stack:** {{technology}}
{{#if components}}
- **Components:** {{components}}
{{/if}}

### Visual Style (Clean & Bright Aesthetic)

**Environment & Background:**
- Clean white to soft warm gray gradient background (#ffffff to #f5f5f7)
- Subtle light blue geometric grid pattern creating depth (#e8f4fc)
- Soft ambient lighting from above, creating gentle shadows
- Airy, open feeling, professional clarity
- Delicate floating particles in pale gold and soft blue

**Material Effects:**
- **Container Boundary:** Large semi-transparent frosted glass panel as main container
- **Component Panels:** Floating small frosted glass cards, rounded rectangles
- **Technology Labels:** Clean holographic labels, rounded corners, subtle glow
- **Data Flow:** Soft gradient particle streams with motion trails
- **Dependency Connections:** Dashed or thin solid lines, color-coded for internal/external

**Color Palette:**

| Element Type | Color | Hex Value | Usage |
|-------------|-------|-----------|-------|
| Service Components | Blue | #3b82f6 | APIs, business services |
| Data Storage | Green | #10b981 | Databases, caches |
| Message Queues | Amber | #f59e0b | MQ, event buses |
| External APIs | Gray | #6b7280 | Third-party services |
| Gateway Entry | Purple | #8b5cf6 | API Gateway |
| Background | White-gray | #ffffff, #f9fafb | - |
| Dark Text | - | #1f2937 | Titles |
| Medium Text | - | #6b7280 | Descriptions |

**Layout Requirements:**
- Container as main focus using large frosted glass panel
- Components organized by layers (presentation, business, data)
- External dependencies outside container boundary
- Clear visual separation between internal and external
- Components floating at different Z-axis depths

**Text Requirements:**
- Container name centered at top, dark color (#1f2937)
- Component names clearly visible within cards
- Technology labels in holographic style (e.g., "TypeScript", "PostgreSQL")
- Brief responsibility descriptions, max 1-2 lines
- Port numbers annotated near relevant components (e.g., :3000, :5432)

**Style Keywords:** clean, bright, airy, professional, frosted glass panels, soft glow, layered depth, floating components, Apple design, Stripe aesthetic, C4 Container diagram, microservice architecture
