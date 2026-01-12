# Data Flow Diagram Prompt

> **语言规则**: 根据用户会话语言自动选择中文或英文提示词，除非用户明确指定语言。

---

## 🌐 中文提示词

一张宽幅 3D 抽象数据可视化图，展示从 **{{source}}** 到 **{{destination}}** 的数据流转过程，采用干净明亮的美学风格。

### 流程信息

- **数据源:** {{source}}
- **目标:** {{destination}}
{{#if steps}}
- **处理步骤:** {{steps}}
{{/if}}

### 🎨 视觉风格 (Clean & Bright Aesthetic)

**环境与背景:**
- 干净的白色至柔和暖灰渐变背景 (#ffffff 到 #f5f5f7)
- 微妙的浅蓝几何网格图案创造景深 (#e8f4fc)
- 来自上方的柔和环境光，创造轻柔阴影
- 通透、开阔的感觉，专业清晰
- 淡金色和柔蓝色精致漂浮粒子点缀空间

**材质效果:**
- **数据源/目标**: 半透明磨砂玻璃容器，较大尺寸
- **处理节点**: 悬浮的磨砂玻璃卡片，带图标
- **数据流**: 渐变色粒子流，带明显的运动轨迹
- **数据存储**: 圆柱形磨砂玻璃容器，绿色系
- **转换标记**: 小型全息标签，显示数据格式

**粒子流效果:**

| 数据类型 | 颜色 | 粒子特征 |
|---------|------|----------|
| 用户请求 | 蓝色 #3b82f6 | 细密连续粒子 |
| API 响应 | 紫色 #8b5cf6 | 中等粒子流 |
| 数据库读写 | 绿色 #10b981 | 较粗粒子流 |
| 消息/事件 | 琥珀色 #f59e0b | 脉冲式粒子 |
| 错误/异常 | 珊瑚色 #fb923c | 虚线粒子流 |

**布局要求:**
- 从左到右的主流向
- 数据源在左侧，目标在右侧
- 处理步骤作为中间的连续节点
- 并行处理垂直排列
- 数据存储节点悬浮最高，处理节点次之

**文字要求:**
- 源和目标清晰标注，使用深色文字
- 处理步骤每个节点有简要描述
- 数据格式在箭头上方标注 (如 JSON, Protobuf)
- 转换说明在数据流旁用小字说明
- 可选标注频率或数据量 (如 "10K/s")

**风格关键词:** 干净、明亮、数据流图、粒子流、磨砂玻璃节点、渐变流动、运动轨迹、苹果设计风格、管道可视化

---

## 🌐 English Prompt

A wide-format 3D abstract data visualization showing the data flow from **{{source}}** to **{{destination}}**, using a clean and bright aesthetic style.

### Flow Information

- **Data Source:** {{source}}
- **Destination:** {{destination}}
{{#if steps}}
- **Processing Steps:** {{steps}}
{{/if}}

### Visual Style (Clean & Bright Aesthetic)

**Environment & Background:**
- Clean white to soft warm gray gradient background (#ffffff to #f5f5f7)
- Subtle light blue geometric grid pattern creating depth (#e8f4fc)
- Soft ambient lighting from above, creating gentle shadows
- Airy, open feeling, professional clarity
- Delicate floating particles in pale gold and soft blue

**Material Effects:**
- **Data Source/Destination:** Semi-transparent frosted glass containers, larger size
- **Processing Nodes:** Floating frosted glass cards with icons
- **Data Flow:** Gradient particle streams with visible motion trails
- **Data Storage:** Cylindrical frosted glass containers, green tones
- **Transform Markers:** Small holographic labels showing data formats

**Particle Stream Effects:**

| Data Type | Color | Particle Characteristics |
|-----------|-------|-------------------------|
| User Requests | Blue #3b82f6 | Fine continuous particles |
| API Responses | Purple #8b5cf6 | Medium particle flow |
| Database Read/Write | Green #10b981 | Thicker particle flow |
| Messages/Events | Amber #f59e0b | Pulsing particles |
| Errors/Exceptions | Coral #fb923c | Dashed particle flow |

**Layout Requirements:**
- Left-to-right main flow direction
- Data source on left, destination on right
- Processing steps as sequential middle nodes
- Parallel processing arranged vertically
- Data storage nodes floating highest, processing nodes next

**Text Requirements:**
- Source and destination clearly labeled with dark text
- Processing steps with brief description per node
- Data formats annotated above arrows (e.g., JSON, Protobuf)
- Transformation logic noted in small text beside data flows
- Optional: frequency or volume indicators (e.g., "10K/s")

**Style Keywords:** clean, bright, data flow diagram, particle stream, frosted glass nodes, gradient flow, motion trails, Apple design, Stripe aesthetic, pipeline visualization
