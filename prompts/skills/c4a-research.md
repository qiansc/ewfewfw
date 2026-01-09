# 调研流程

**参数**: $ARGUMENTS

## 1. 识别用户意图

根据 `$ARGUMENTS` 智能路由：

| $ARGUMENTS 值 | 行为 |
|---------------|------|
| 空 / "列表" / "list" | 列出调研文档 |
| "help" / "帮助" / "?" | 显示功能介绍 |
| Git URL (github/gitlab) | clone 并分析仓库 |
| 普通 URL | WebFetch 抓取分析 |
| .md 文件路径 | 读取本地文档 |
| "clean" / "清空" | 清空调研目录 |
| "总结" / 其他文本 | 总结当前对话 |

**显示帮助（用户输入 help 时）：**
```
📖 /c4a/research 功能介绍

支持以下操作：
  1. 列出调研文档 - 查看 .c4a/research/ 下的文件
  2. 调研 Git 仓库 - clone 并分析仓库结构
  3. 调研网页 URL - 抓取内容并生成摘要
  4. 读取本地文档 - 理解 .md 文件内容
  5. 清空调研目录 - 删除所有调研文件
  6. 总结对话 - 生成当前对话的结构化总结

用法示例：
  /c4a/research                          列出文档
  /c4a/research https://github.com/xxx   调研仓库
  /c4a/research https://example.com      调研网页
  /c4a/research ./docs/design.md         读取文档
  /c4a/research clean                    清空目录
```

## 2. 执行对应操作

**列出调研文档（$ARGUMENTS 为空或 list）：**
```bash
ls -la .c4a/research/ 2>/dev/null || echo "目录不存在"
```
输出格式：
```
📁 调研文档 (.c4a/research/)

| 文件名 | 大小 | 修改时间 |
|--------|------|----------|
| xxx.md | 2KB  | 2024-01-07 |

💡 使用方法:
  /c4a/research <url>     调研 URL/仓库
  /c4a/research clean     清空目录
```

**调研 Git 仓库（$ARGUMENTS 为 Git URL）：**
- clone 到 `.c4a/research/<repo>/`
- 分析目录结构、README、核心代码
- 生成调研报告

**调研普通 URL（$ARGUMENTS 为普通 URL）：**
- 使用 WebFetch 抓取内容
- 提取关键信息，生成摘要

**读取本地文档（$ARGUMENTS 为 .md 路径）：**
- 使用 read 工具读取文件
- 理解内容，提取要点

**清空调研目录（$ARGUMENTS 为 clean）：**
```
⚠️ 即将删除以下文件:
  - xxx.md
  - yyy.md

确认清空？
  1. 确认删除
  2. 取消
```
确认后执行 `rm -rf .c4a/research/*`

**总结对话：**
- 回顾对话历史
- 提取关键决策和讨论点
- 生成结构化总结

## 3. 保存调研结果（调研类操作）

建议默认文件名，询问用户确认：
```
是否保存调研结果？
  1. 保存到 .c4a/research/<name>.md（推荐）
  2. 使用其他文件名
  3. 不保存，直接输出
```
使用 edit 工具写入文件

## 4. 输出结果

```
✅ 调研完成

📄 已保存: .c4a/research/<name>.md

📋 摘要:
  <关键发现 3-5 点>

🔜 下一步: /c4a/adr/draft 创建 ADR
```
