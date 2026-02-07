---
name: "c4a:know:search"
description: |
  语义搜索知识库。触发条件：
  - "搜索 xxx"、"查找 xxx"、"找一下 xxx"
  - "有没有关于 xxx 的知识"、"xxx 相关的内容"
  用于：快速查找知识库中的相关实体和文档，支持按类型和范围筛选
---

# /c4a:know:search - 搜索知识库

## 命令格式

```
/c4a:know:search <query>                    # 语义搜索
/c4a:know:search <query> --scope=<scope>    # 限定范围搜索
/c4a:know:search <query> --type=<type>      # 限定类型搜索
```

## 参数说明

| 参数 | 说明 | 可选值 |
|------|------|--------|
| `query` | 搜索关键词 | 自然语言描述 |
| `--scope` | 知识层级 | `domain`、`enterprise`、`project` |
| `--type` | 实体类型 | `system`、`container`、`component`、`adr`、`contract`、`sor`、`process`、`product` |

## 工具编排

1. 调用 `c4a_query_search` 执行语义搜索
2. 按相关度排序结果
3. 展示匹配的实体（ID、类型、摘要）
4. 提供详细查看选项

## 输出格式

```
🔍 搜索中...

找到 N 个相关结果：

1. [类型] entity-id (层级)
   描述：实体描述
   相关度：XX%

2. [类型] entity-id (层级)
   描述：实体描述
   相关度：XX%

输入序号查看详情，或继续搜索其他关键词
```

## 示例

**基础搜索**:
```
用户: 搜索订单状态机
→ 调用 c4a_query_search(query="订单状态机")
→ 展示相关实体列表
```

**限定类型搜索**:
```
用户: /c4a:know:search "认证服务" --type=container
→ 调用 c4a_query_search(query="认证服务", scope="container")
→ 仅展示 Container 类型结果
```

**限定范围搜索**:
```
用户: /c4a:know:search "Redis 缓存" --scope=enterprise
→ 调用 c4a_query_search(query="Redis 缓存")
→ 筛选 Enterprise 层级结果
```

## 工具依赖

- `c4a_query_search`: 语义搜索（参数：query, scope, requirement_id, limit, offset）
