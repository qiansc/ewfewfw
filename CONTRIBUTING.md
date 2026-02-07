# 文档编写规范

## 概述

本规范定义技术文档的编写标准，分为三个层次：

1. **核心原则**：AI-First、当前时态、模块化
2. **内容规范**：必需章节、信息密度、真实性验证、禁止词汇
3. **格式规范**：代码块规则、正反对比、Markdown/Mermaid 格式

## 核心原则

### 1. AI-First
- 一二级标题体现文档整体结构，便于快速导航
- 文档开头提供概述，介绍整体逻辑和章节关系
- 关键信息用结构化格式（列表、表格、代码块）

### 2. 当前时态
- 只描述已实现功能，不记录计划
- 删除组件时直接移除描述，不保留历史痕迹
- 变更历史放 `changelog/` 目录

### 3. 模块化
- 按模块组织，每个核心模块一个文档
- 模块间用相对链接引用

## 信息密度要求

**重点是有效传达信息，而非追求文件大小。**

参考范围（非硬性要求）：

| 文档类型 | 参考规模 | 说明 |
|----------|----------|------|
| 核心模块 | 10-30KB | 与代码复杂度相关 |
| 支撑模块 | 5-20KB | |
| 指南类 | 3-15KB | |

避免为凑篇幅而添加冗余内容。简洁清晰优于冗长详尽。

## 必需章节

每个架构文档必须包含：

| 章节 | 内容要求 |
|------|----------|
| **概述** | 位置、职责、核心功能列表 |
| **组件** | 组件列表、关系图（Mermaid）、每个组件职责 |
| **依赖关系** | 内部依赖（import 的模块）、外部依赖（requirements.txt） |
| **数据流** | 处理流程图、输入/输出格式 |
| **接口** | API 端点、类方法签名、使用示例 |

**可选章节**：扩展点（仅当存在抽象基类时）、配置（仅当有配置文件时）

## 真实性验证

**必须**：
- 每个技术细节对应代码实现
- 引用路径真实存在
- 配置项在代码中有使用

**禁止**：
- 虚构配置文件、部署配置、监控端点
- 假想的故障处理、性能指标
- 不存在的版本兼容性

## 数据模型变更检查

当新增/移除字段或实体类型时，必须同步检查以下位置是否需要更新：
- `packages/core/src/types/` 与 Schema 文件
- `packages/storage/src/` 的适配器与迁移逻辑
- MCP 工具输入/输出（`packages/mcp-*/src/schemas.ts`）
- 文档与变更日志（`README.md`、`ARCHITECTURE.md`、`changelog/`）
- Server 模式配置（`docker/docker-compose.server.yml`）

## 禁止词汇

| 类别 | 禁止词汇 | 替代方案 |
|------|----------|----------|
| 模糊形容词 | 高性能、可扩展、灵活、鲁棒、强大、智能、先进 | 使用具体指标或描述 |
| 营销语言 | 革命性、突破性、领先、卓越、完美 | 使用具体数据或承认限制 |
| 模糊量词 | 大量、许多、少量、若干、部分 | 使用具体数量或范围 |
| 未来语言 | 将要、计划实现、未来将、即将、TODO、待实现 | 移到 issues 或不写 |
| 冗余版本号 | `version: v0.1`、`C4A v0.3.1` | 仅在 JSON Schema、发布文档中使用 |

## 代码块规则

### 判断标准

写代码块前问两个问题：

1. **这段代码是给谁看的？**
   - 给扩展者或使用者 → ✅ 保留
   - 仅展示内部实现 → ❌ 删除

2. **这段代码能帮助别人做什么？**
   - 指导扩展或使用 → ✅ 保留
   - 只是说明"我们怎么做的" → ❌ 删除

### 允许 vs 禁止

| ✅ 允许 | ❌ 禁止 |
|---------|---------|
| 抽象类/接口定义 | 具体实现类的完整代码 |
| 如何调用接口的示例 | 算法实现细节 |
| 多接口协作示例 | 私有方法、工具函数 |

### 示例对比

**✅ 允许 - 扩展点说明**
```ts
interface Signal {
  direction: "BUY" | "SELL";
  confidence: number;
}

type DataFrame = unknown;

abstract class BaseStrategy {
  abstract analyze(symbol: string, data: DataFrame): Signal;
}
```

**❌ 禁止 - 内部实现**
```ts
// 不要展示具体策略的完整实现
class RsiStrategy extends BaseStrategy {
  analyze(symbol: string, data: DataFrame): Signal {
    const rsi = this.calculateRsi(data); // 内部算法细节
    if (rsi < 30) {
      return { direction: "BUY", confidence: 0.7 };
    }
    return { direction: "SELL", confidence: 0.4 };
  }

  private calculateRsi(_data: DataFrame): number {
    return 42;
  }
}
```

## 正反对比原则

**直接描述**：在文档中使用正反对比（✅/❌）帮助读者理解边界。

示例场景：
- 标题命名：正确格式 vs 错误格式
- 代码块：允许场景 vs 禁止场景
- 配置引用：基于实际代码 vs 虚构

## 格式规范

### Markdown
- 标题层级 ≤4 层
- 代码块指定语言
- 表格必须有表头
- 内部链接必须有效

### Mermaid 图表
- **强制使用**：所有架构图、流程图必须用 Mermaid
- **优先 flowchart**：比 graph 更现代
- **节点换行**：使用 `<br/>`
- **嵌套代码块**：用 `~~~`

### 语言
- 标准语言：中文
- 术语首次出现提供英文对照
- 代码注释用中文，变量函数名用英文

### 敏感信息
- API 密钥：`your_api_key_here`
- 内部路径：`/path/to/config`
- 数据库连接：`user:pass@localhost:5432/dbname`

## 质量检查清单

### 图表检查
- [ ] 每个核心模块至少一个关系图
- [ ] 图表类型正确（flowchart/sequenceDiagram/classDiagram）

### 元素检查
- [ ] 每个章节有概述段落
- [ ] 每个组件有职责说明
- [ ] 每个接口有使用示例

### 真实性检查
- [ ] 引用的文件路径存在
- [ ] 配置项在代码中有使用
- [ ] API 端点在路由中有实现

### 语言检查
- [ ] 无禁止词汇
- [ ] 无未来语言
- [ ] 无日期标记的变更记录

## Changelog 规范

### 目录结构

```
changelog/
├── unreleased/           # 未发布的变更碎片
│   ├── feat-xxx.md
│   └── fix-yyy.md
├── v0.3.1.md             # 已发布版本
└── v0.2.0.md
```

### 碎片文件命名

格式：`<类型>-<简短描述>.md`

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `change` | 变更 |
| `remove` | 移除 |
| `security` | 安全修复 |

示例：`feat-server-mode.md`、`fix-concurrent-warning.md`

### 碎片文件内容

```markdown
简短描述变更内容（一行）

可选：详细说明（如有必要）
```

### 发布流程

1. 合并 `unreleased/*.md` 到 `changelog/vX.Y.Z.md`
2. 清空 `unreleased/` 目录
3. 创建 GitHub Release：`gh release create vX.Y.Z -F changelog/vX.Y.Z.md`

### 版本文件格式

```markdown
# vX.Y.Z (YYYY-MM-DD)

## Added
- 新功能描述

## Changed
- 变更描述

## Fixed
- 修复描述

## Removed
- 移除描述
```
