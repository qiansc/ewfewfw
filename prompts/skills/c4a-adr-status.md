# ADR 状态查看

**参数**: $ARGUMENTS

## 1. 识别用户意图

根据 `$ARGUMENTS` 智能路由：

| $ARGUMENTS 值 | 行为 |
|---------------|------|
| 空 | 显示状态总览（按状态分组） |
| "help" / "帮助" / "?" | 显示功能介绍 |
| ADR ID (如 `adr-001`) | 显示指定 ADR 详情 |
| "draft" / "approved" / "published" | 筛选指定状态的 ADR |

**显示帮助（用户输入 help 时）：**
```
📖 /c4a/adr/status 功能介绍

查看 ADR 状态的多种方式：
  1. 状态总览 - 按状态分组显示所有 ADR
  2. ADR 详情 - 查看指定 ADR 的完整信息
  3. 状态筛选 - 只显示特定状态的 ADR

用法示例：
  /c4a/adr/status              显示总览
  /c4a/adr/status adr-001      查看详情
  /c4a/adr/status draft        筛选草稿
  /c4a/adr/status approved     筛选已批准
  /c4a/adr/status published    筛选已发布
```

## 2. 执行对应操作

**状态总览（$ARGUMENTS 为空）：**
- 调用 c4a_local_list_files(type: "adr")
- 按状态分组显示：
```
📋 ADR 状态总览

## Draft (2)
| 编号 | 标题 | 修改时间 |
|------|------|----------|
| adr-001 | 引入消息队列 | 2024-01-07 |
| adr-002 | 升级数据库 | 2024-01-06 |

## Approved (1)
| 编号 | 标题 | 批准人 | 批准时间 |
|------|------|--------|----------|
| adr-003 | 重构认证模块 | @zhangsan | 2024-01-05 |

## Published (3)
| 编号 | 标题 | 发布时间 |
|------|------|----------|
| ADR-001 | 选择 TypeScript | 2024-01-01 |
...

💡 操作提示:
  /c4a/adr/review adr-001    评审草稿
  /c4a/adr/status adr-001    查看详情
```

**指定 ADR 详情（$ARGUMENTS 为 ADR ID）：**
- 调用 c4a_local_read_file(id: $ARGUMENTS, type: "adr")
- 显示详细信息：
```
📋 ADR $ARGUMENTS 详情

## 基本信息
- 编号: $ARGUMENTS
- 标题: <从文件读取>
- 状态: <从文件读取>
- 创建时间: <从文件读取>
- 文件位置: .c4a/drafts/$ARGUMENTS/

## 关联文件
- $ARGUMENTS.c4a.yaml
- containers/<container-id>.c4a.yaml

## 内容摘要
### 背景
<context 内容摘要>

### 决策
<decision 内容摘要>

💡 操作提示:
  /c4a/adr/review $ARGUMENTS    开始评审
```

**筛选指定状态（$ARGUMENTS 为 draft/approved/published）：**
- 调用 c4a_local_list_files(type: "adr", status: $ARGUMENTS)
- 只显示该状态的 ADR 列表
