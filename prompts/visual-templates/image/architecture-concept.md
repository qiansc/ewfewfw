# Architecture Concept Image Prompt

> **语言规则**: 根据用户会话语言自动选择中文或英文提示词，除非用户明确指定语言。

---

## 🌐 中文提示词

一张宽幅 3D 抽象数据可视化图，展示 **{{title}}** 的架构概念，采用干净明亮的美学风格。

### 图片信息

- **标题:** {{title}}
{{#if theme}}
- **主题风格:** {{theme}}
{{else}}
- **主题风格:** modern tech
{{/if}}
{{#if elements}}
- **关键元素:** {{elements}}
{{/if}}

### 🎨 视觉风格 (Clean & Bright Aesthetic)

**核心美学:**
这是一张 **干净明亮** 的 3D 抽象可视化图，采用 **Apple/Stripe 设计语言**：
- 专业温暖，轻盈通透
- 适合浅色技术文档嵌入
- 现代科技感与优雅并存

**环境与背景:**
- 干净的白色至柔和暖灰渐变背景 (#ffffff 到 #f5f5f7)
- 微妙的浅蓝几何网格图案创造景深 (#e8f4fc)
- 来自上方的柔和环境光，创造轻柔阴影
- 通透、开阔的感觉，专业清晰
- 淡金色和柔蓝色精致漂浮粒子点缀空间

**材质效果:**
- **主要元素**: 半透明磨砂玻璃效果，20-30% 透明度
- **边缘处理**: 微白光晕，柔和边界
- **容器形状**: 圆角矩形，柔和白色边框
- **投影效果**: 轻微投影增加层次感
- **深度感**: 元素悬浮于不同 Z 轴深度

**配色方案:**

| 类别 | 名称 | 色值 | 用途 |
|------|------|------|------|
| 背景 | 纯白 | #ffffff | 主背景 |
| 背景 | 暖灰 | #f9fafb | 背景渐变 |
| 主色 | 蓝色 | #3b82f6 | 主要元素 |
| 主色 | 紫色 | #8b5cf6 | 次要元素 |
| 主色 | 绿色 | #10b981 | 成功状态 |
| 强调 | 珊瑚色 | #fb923c | 警告 |
| 强调 | 琥珀色 | #f59e0b | 提醒 |
| 语义 | 成功 | #10b981 | ✓ + 绿光晕 |
| 语义 | 警告 | #f59e0b | △ + 黄光晕 |
| 语义 | 错误 | #ef4444 | ✗ + 红光晕 |

**布局要求:**
- 中央焦点代表主概念
- 放射状连接展示相关元素
- 使用透明度效果创造层次
- Z 轴深度体现重要性层级
- 使用三分法放置元素

**风格关键词:** 干净、明亮、通透、专业、优雅、极简、精致、磨砂玻璃、柔和光晕、轻柔阴影、漂浮元素、苹果设计风格、高端 SaaS 仪表盘、3D 抽象可视化、全息标签、技术概念艺术

---

## 🌐 English Prompt

A wide-format 3D abstract data visualization showing the architecture concept of **{{title}}**, using a clean and bright aesthetic style.

### Image Information

- **Title:** {{title}}
{{#if theme}}
- **Theme:** {{theme}}
{{else}}
- **Theme:** modern tech
{{/if}}
{{#if elements}}
- **Key Elements:** {{elements}}
{{/if}}

### Visual Style (Clean & Bright Aesthetic)

**Core Aesthetics:**
This is a **clean and bright** 3D abstract visualization using **Apple/Stripe design language**:
- Professional warmth, light and airy
- Suitable for embedding in light-themed technical documentation
- Modern tech feel with elegance

**Environment & Background:**
- Clean white to soft warm gray gradient background (#ffffff to #f5f5f7)
- Subtle light blue geometric grid pattern creating depth (#e8f4fc)
- Soft ambient lighting from above, creating gentle shadows
- Airy, open feeling, professional clarity
- Delicate floating particles in pale gold and soft blue

**Material Effects:**
- **Primary Elements:** Semi-transparent frosted glass effect, 20-30% transparency
- **Edge Treatment:** Soft white glow, gentle boundaries
- **Container Shapes:** Rounded rectangles, soft white borders
- **Shadow Effects:** Subtle drop shadows for layered depth
- **Depth Perception:** Elements floating at different Z-axis depths

**Color Palette:**

| Category | Name | Hex Value | Usage |
|----------|------|-----------|-------|
| Background | Pure White | #ffffff | Main background |
| Background | Warm Gray | #f9fafb | Gradient background |
| Primary | Blue | #3b82f6 | Main elements |
| Primary | Purple | #8b5cf6 | Secondary elements |
| Primary | Green | #10b981 | Success states |
| Accent | Coral | #fb923c | Warnings |
| Accent | Amber | #f59e0b | Alerts |
| Semantic | Success | #10b981 | ✓ + green glow |
| Semantic | Warning | #f59e0b | △ + yellow glow |
| Semantic | Error | #ef4444 | ✗ + red glow |

**Layout Requirements:**
- Central focus representing main concept
- Radial connections showing related elements
- Transparency effects for layered depth
- Z-axis depth reflecting importance hierarchy
- Rule of thirds for element placement

**Style Keywords:** clean, bright, airy, professional, elegant, minimal, sophisticated, frosted glass, soft glow, gentle shadows, floating elements, Apple design, Stripe aesthetic, premium SaaS dashboard, 3D abstract visualization, holographic labels, tech concept art
