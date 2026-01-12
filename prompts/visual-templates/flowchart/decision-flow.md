# Decision Flow Diagram Prompt

> **语言规则**: 根据用户会话语言自动选择中文或英文提示词，除非用户明确指定语言。

---

## 🌐 中文提示词

一张宽幅 3D 抽象数据可视化图，展示 **{{decision_title}}** 的决策流程，采用干净明亮的美学风格。

### 决策信息

- **决策标题:** {{decision_title}}
- **备选方案:** {{options}}
- **最终决策:** {{outcome}}

### 🎨 视觉风格 (Clean & Bright Aesthetic)

**环境与背景:**
- 干净的白色至柔和暖灰渐变背景 (#ffffff 到 #f5f5f7)
- 微妙的浅蓝几何网格图案创造景深 (#e8f4fc)
- 来自上方的柔和环境光，创造轻柔阴影
- 通透、开阔的感觉，专业清晰
- 淡金色和柔蓝色精致漂浮粒子点缀空间

**材质效果:**
- **流程节点**: 半透明磨砂玻璃效果，圆角矩形或菱形
- **决策菱形**: 较大的磨砂玻璃菱形，边缘微白光晕
- **路径箭头**: 柔和渐变色，带流动粒子效果
- **选中路径**: 明亮的绿色粒子流，带柔和光晕
- **未选路径**: 灰色虚线粒子流，降低透明度

**状态指示器:**

| 状态 | 图标 | 颜色 | 光晕效果 |
|------|------|------|----------|
| 起点 | 圆角矩形 | 蓝色 #3b82f6 | 柔和蓝光晕 |
| 决策点 | 菱形 | 琥珀色 #f59e0b | 柔和黄光晕 |
| 选中方案 | ✓ 勾选 | 绿色 #10b981 | 柔和绿光晕 |
| 未选方案 | ○ 空心圆 | 灰色 #9ca3af | 无光晕 |
| 终点成功 | ✓ 圆角矩形 | 绿色 #10b981 | 明亮绿光晕 |
| 终点警告 | △ 三角形 | 琥珀色 #f59e0b | 柔和黄光晕 |

**布局要求:**
- 从上到下的流程方向
- 决策菱形居中作为视觉焦点
- 分支选项对称排列
- 在最终结果前有汇聚点
- 决策菱形悬浮最高层，选中路径节点略微突出

**文字要求:**
- 决策标题顶部居中，醒目显示
- 选项标签在每个分支上清晰标注
- 评估标准在决策路径旁简要说明
- 最终结论使用全息标签突出显示
- 理由说明在相关节点下方用中灰色小字标注

**风格关键词:** 干净、明亮、决策流程图、磨砂玻璃节点、柔和光晕、粒子流动、选中路径高亮、苹果设计风格、ADR 可视化

---

## 🌐 English Prompt

A wide-format 3D abstract data visualization showing the decision flow of **{{decision_title}}**, using a clean and bright aesthetic style.

### Decision Information

- **Decision Title:** {{decision_title}}
- **Options Considered:** {{options}}
- **Final Decision:** {{outcome}}

### Visual Style (Clean & Bright Aesthetic)

**Environment & Background:**
- Clean white to soft warm gray gradient background (#ffffff to #f5f5f7)
- Subtle light blue geometric grid pattern creating depth (#e8f4fc)
- Soft ambient lighting from above, creating gentle shadows
- Airy, open feeling, professional clarity
- Delicate floating particles in pale gold and soft blue

**Material Effects:**
- **Flow Nodes:** Semi-transparent frosted glass effect, rounded rectangles or diamonds
- **Decision Diamond:** Larger frosted glass diamond, soft white glow at edges
- **Path Arrows:** Soft gradient colors with flowing particle effects
- **Selected Path:** Bright green particle flow with soft glow
- **Unselected Paths:** Gray dashed particle flow, reduced transparency

**Status Indicators:**

| Status | Icon | Color | Glow Effect |
|--------|------|-------|-------------|
| Start | Rounded Rectangle | Blue #3b82f6 | Soft blue glow |
| Decision Point | Diamond | Amber #f59e0b | Soft yellow glow |
| Selected Option | ✓ Checkmark | Green #10b981 | Soft green glow |
| Unselected Option | ○ Empty Circle | Gray #9ca3af | No glow |
| End Success | ✓ Rounded Rectangle | Green #10b981 | Bright green glow |
| End Warning | △ Triangle | Amber #f59e0b | Soft yellow glow |

**Layout Requirements:**
- Top-to-bottom flow direction
- Decision diamond centered as visual focus
- Branch options arranged symmetrically
- Convergence point before final outcome
- Decision diamond floating highest, selected path nodes slightly prominent

**Text Requirements:**
- Decision title centered at top, prominently displayed
- Option labels clearly marked on each branch
- Evaluation criteria briefly noted along decision paths
- Final conclusion highlighted with holographic label
- Rationale noted in medium gray small text below relevant nodes

**Style Keywords:** clean, bright, decision flowchart, frosted glass nodes, soft glow, particle flow, selected path highlight, Apple design, Stripe aesthetic, ADR visualization
