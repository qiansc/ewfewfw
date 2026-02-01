# Part 13 验收清单: Server 模式集成收尾

**任务范围:** 验证清单剩余项（MongoDB/Neo4j/Milvus/Embedding/c4a install server）
**验收时间:** 2026-02-01

## 设计文档对照

| 设计项 | 行号 | 说明 | 状态 |
|--------|------|------|:----:|
| architecture.md §1.1/§1.4/§1.5 | L16-220 | 三模式架构与存储适配层 | [x] |
| mode-switch.md §5.1-5.2 | L1-100 | 模式切换流程 | [x] |

## 验证步骤

| 验证项 | 命令/方式 | 结果 |
|--------|-----------|:----:|
| MongoDB/Neo4j/Milvus 健康检查 | `curl -fsSL http://localhost:8055/health` | ✅ |
| Embedding (Ollama) | `docker compose -f docker/docker-compose.server.yml up -d ollama-init` | ✅ |
| 三库+搜索/图/备份集成回归 | `python3 packages/storage-backend/scripts/integration_regression.py --base-url http://localhost:8055 --timeout 30` | ✅ |
| c4a install server | `bun run --filter @c4a/cli dev -- install server` | ✅ |

## 关键修复

| 问题 | 处理 | 状态 |
|------|------|:----:|
| MCP Docker 构建缺失 workspace 依赖 | Dockerfile.mcp-ts 补齐 packages/storage 与 mcp-extract scripts 复制 | ✅ |
| MCP Docker 构建缺失 tsconfig | 添加根 `tsconfig.json` | ✅ |
| storage-backend 健康检查失败（无 curl） | compose healthcheck 改用 python | ✅ |

## 结论: ✅ 通过
