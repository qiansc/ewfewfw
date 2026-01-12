# System Architecture Diagram Prompt

> **语言规则**: 根据用户会话语言自动选择中文或英文提示词，除非用户明确指定语言。

---

## 🌐 中文提示词

一张宽幅 3D 抽象数据可视化图，展示 **{{system_name}}** 的系统架构，采用干净明亮的美学风格。

## 系统信息

- **系统名称:** {{system_name}}
- **描述:** {{description}}
{{#if containers}}
- **关键容器:** {{containers}}
{{/if}}

---

## 🎨 视觉风格 (Clean & Bright Aesthetic)

### 环境与背景

- 干净的白色至柔和暖灰渐变背景 (#ffffff 到 #f5f5f7)
- 微妙的浅蓝几何网格图案创造景深 (#e8f4fc)
- 来自上方的柔和环境光，创造轻柔阴影
- 通透、开阔的感觉，专业清晰
- 淡金色和柔蓝色精致漂浮粒子点缀空间

### 材质效果

- **主系统容器**: 半透明磨砂玻璃效果，20-30% 透明度，边缘微白光晕
- **系统边界**: 柔和虚线，带轻微发光效果
- **外部系统**: 实心但较浅的磨砂玻璃，灰色调 (#6b7280)
- **内部组件**: 圆角矩形，柔和白色边框，轻微投影
- **连接线**: 柔和渐变色箭头，带流动粒子效果

### 配色方案

| 元素 | 颜色 | 色值 |
|------|------|------|
| 背景 | 白到暖灰 | #ffffff, #f9fafb |
| 主系统 | 蓝色系 | #3b82f6 (边框), #60a5fa (光晕) |
| 外部系统 | 灰色系 | #6b7280 (边框), #9ca3af (填充) |
| 用户角色 | 紫色系 | #8b5cf6 (边框), #a78bfa (光晕) |
| 数据存储 | 绿色系 | #10b981 (边框), #34d399 (光晕) |
| 文字深色 | - | #1f2937 |
| 文字中灰 | - | #6b7280 |

---

## 📐 布局要求

### 整体结构

- 主系统居中，作为视觉焦点
- 外部用户/系统围绕主系统周边排列
- 清晰的从上到下层级结构
- 元素之间保持充足间距
- 悬浮于略微不同的 Z 轴深度，创造立体感

### 系统边界

- 使用柔和虚线清晰标记系统边界
- 边界内部有微妙的渐变填充 (#f9fafb 到 #ffffff)
- 外部实体明确位于边界之外

### 图例

- 右下角放置简洁图例，使用全息标签风格
- 解释不同颜色和形状的含义

---

## 📝 文字要求

- **系统名称**: 顶部居中，醒目显示，使用深色 (#1f2937)
- **容器名称**: 清晰可读，圆角全息标签样式
- **简要描述**: 每个元素下方，最多 2 行，中灰色 (#6b7280)
- **关系标签**: 在箭头上方或旁边，描述数据流向

---

## ✨ 风格关键词

**英文**: clean, bright, airy, professional, elegant, frosted glass, soft glow, gentle shadows, floating elements, Apple design, Stripe aesthetic, C4 Model diagram, system context

**中文**: 干净、明亮、通透、专业、优雅、磨砂玻璃、柔和光晕、轻柔阴影、漂浮元素、苹果设计风格、系统上下文图

---

## 🌐 English Prompt

A wide-format 3D abstract data visualization showing the system architecture of **{{system_name}}**, using a clean and bright aesthetic style.

### System Information

- **System Name:** {{system_name}}
- **Description:** {{description}}
{{#if containers}}
- **Key Containers:** {{containers}}
{{/if}}

### Visual Style (Clean & Bright Aesthetic)

**Environment & Background:**
- Clean white to soft warm gray gradient background (#ffffff to #f5f5f7)
- Subtle light blue geometric grid pattern creating depth (#e8f4fc)
- Soft ambient lighting from above, creating gentle shadows
- Airy, open feeling, professional clarity
- Delicate floating particles in pale gold and soft blue

**Material Effects:**
- Semi-transparent frosted glass effect, 20-30% transparency
- Soft white glow at edges
- Rounded rectangles with soft white borders
- Gentle drop shadows for layered depth

**Color Palette:**
- Background: #ffffff, #f9fafb (white to warm gray)
- Primary System: #3b82f6 (blue border), #60a5fa (glow)
- External Systems: #6b7280 (gray border), #9ca3af (fill)
- User Roles: #8b5cf6 (purple border), #a78bfa (glow)
- Data Storage: #10b981 (green border), #34d399 (glow)
- Text: #1f2937 (dark), #6b7280 (medium)

**Layout:**
- Main system centered as visual focus
- External users/systems around the perimeter
- Clear top-to-bottom hierarchy
- Adequate spacing between elements
- Elements floating at different Z-axis depths

**Style Keywords:** clean, bright, airy, professional, elegant, frosted glass, soft glow, gentle shadows, floating elements, Apple design, Stripe aesthetic, C4 Model diagram, system context
