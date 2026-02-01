# Part 13 Server Mode - Agent 提示词

> 执行顺序：Agent-0（前置准备）→ Agent-1~4 并行 → Agent-5（集成收尾）

---

## 概述

Server Mode 模块实现团队协作的服务器模式，包括：

| 子模块 | 设计文档 | 核心能力 | 任务编号 |
|--------|---------|---------|---------|
| ServerAdapter 实现 | [architecture.md](../v0.3.0/architecture.md) §1.1-1.2 | MongoDB/Neo4j/Milvus 适配器 | 13.1-13.4 |
| storage-backend 服务 | [architecture.md](../v0.3.0/architecture.md) §1.1 | Python 后端封装数据库访问 | 13.5-13.8 |
| 权限系统 | [cross-project-auth.md](../v0.3.0/detailed-design/permissions/cross-project-auth.md) | 多用户权限检查 | 13.9-13.12 |
| 模式切换 | [mode-switch.md](../v0.3.0/detailed-design/local-mode/mode-switch.md) | Local↔Server 数据迁移 | 13.13-13.16 |
| CLI Server 命令 | [user-cli.md](../v0.3.0/detailed-design/cli/user-cli.md) §2.4 | c4a server 子菜单完善 | 13.17-13.20 |

**依赖关系**：
- 依赖 Part 06 Local Mode 的 StorageAdapter 接口定义
- 依赖 Part 07 Data Ops 的同步/导出引擎
- 依赖 Part 08 User CLI 的命令框架
- 被 Part 11 Permissions 依赖（权限系统基础）

**优先级说明**：

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P0 | Agent-0 + 13.1-13.4 | ServerAdapter 核心实现 |
| P0 | 13.5-13.8 | storage-backend Python 服务 |
| P1 | 13.9-13.12 | 权限系统集成 |
| P1 | 13.13-13.16 | 模式切换完善 |
| P2 | 13.17-13.20 | CLI 命令完善 |

---

## Agent-0：前置准备（必须先完成）

```
你作为 v0.3.0-plan-opus/13-server-mode.md 里的 Agent-0 负责实现前置准备任务。

请执行 Part 13 Server Mode 的前置准备任务：

1. 阅读设计文档：
   - v0.3.0/architecture.md §1.1-1.2（三模式架构、存储层可插拔）
   - v0.3.0/detailed-design/local-mode/mode-switch.md（模式切换机制）
   - v0.3.0/detailed-design/permissions/cross-project-auth.md（权限控制）
   - v0.3.0/detailed-design/mcp/store-utils.md（备份/恢复工具）

2. 确认依赖模块已完成：
   - Part 06 Local Mode：StorageAdapter 接口已定义
   - Part 07 Data Ops：sync/export 引擎可用
   - Part 08 User CLI：c4a server 命令框架已存在
   - 验证：bun run --filter @c4a/storage test

3. 创建 storage-backend 目录结构（任务 13.21）：

   packages/storage-backend/
   ├── src/
   │   ├── __init__.py
   │   ├── main.py                 # FastAPI 入口
   │   ├── config.py               # 配置管理
   │   ├── adapters/               # 数据库适配器
   │   │   ├── __init__.py
   │   │   ├── mongodb.py          # MongoDB 适配器
   │   │   ├── neo4j.py            # Neo4j 适配器
   │   │   └── milvus.py           # Milvus 适配器
   │   ├── services/               # 业务服务
   │   │   ├── __init__.py
   │   │   ├── entity.py           # 实体 CRUD
   │   │   ├── relation.py         # 关系管理
   │   │   ├── vector.py           # 向量搜索
   │   │   ├── embedding.py        # Embedding 服务（Ollama/OpenAI）
   │   │   └── permission.py       # 权限检查
   │   ├── routes/                 # API 路由
   │   │   ├── __init__.py
   │   │   ├── entities.py         # 实体 CRUD 端点
   │   │   ├── relations.py        # 关系管理端点
   │   │   ├── search.py           # 搜索端点
   │   │   ├── graph.py            # 图查询端点
   │   │   └── permissions.py      # 权限管理端点
   │   ├── middleware/             # 中间件
   │   │   ├── __init__.py
   │   │   ├── auth.py             # 认证中间件
   │   │   └── permission_check.py # 权限校验装饰器
   │   ├── models/                 # 数据模型
   │   │   ├── __init__.py
   │   │   ├── entity.py
   │   │   ├── relation.py
   │   │   └── permission.py
   │   └── utils/                  # 工具函数
   │       ├── __init__.py
   │       └── hash.py
   ├── tests/
   │   ├── __init__.py
   │   ├── test_mongodb.py
   │   ├── test_neo4j.py
   │   └── test_milvus.py
   ├── pyproject.toml
   ├── requirements.txt
   └── Dockerfile

4. 创建 pyproject.toml：
   ```toml
   [project]
   name = "c4a-storage-backend"
   version = "0.3.0"
   description = "C4A Storage Backend - MongoDB/Neo4j/Milvus adapter"
   requires-python = ">=3.11"
   dependencies = [
       "fastapi>=0.109.0",
       "uvicorn>=0.27.0",
       "motor>=3.3.0",             # 异步 MongoDB 驱动
       "pymongo>=4.6.0",
       "neo4j>=5.15.0",
       "pymilvus>=2.3.0",
       "pydantic>=2.5.0",
       "python-dotenv>=1.0.0",
       "httpx>=0.26.0",            # Ollama/OpenAI HTTP 调用
       "openai>=1.0.0",            # OpenAI Embedding（可选增强）
   ]

   [project.optional-dependencies]
   dev = [
       "pytest>=7.4.0",
       "pytest-asyncio>=0.23.0",
       "ruff>=0.1.0",
       "mypy>=1.8.0",
   ]
   ```

   > **包位置说明**：`storage-backend` 是独立的 Python 服务，不计入 TypeScript package 清单（@c4a/core、@c4a/storage、@c4a/cli）。

5. 更新 ServerAdapter 占位实现（任务 13.22）：
   - 修改 packages/storage/src/server-adapter.ts
   - 添加 HTTP/gRPC 客户端调用 storage-backend（v0.3.0 优先 HTTP，预留 gRPC 扩展）
   - 保持与 LiteAdapter 相同的接口签名

6. 更新 Docker Compose 配置：
   - 添加 storage-backend 服务
   - 添加 Ollama 服务（Embedding 默认提供者）
   - 配置服务间网络
   - 添加健康检查

7. 产物：
   - packages/storage-backend/ 目录（Python 后端骨架）
   - packages/storage/src/server-adapter.ts 更新
   - docker/docker-compose.server.yml 更新
   - 验证：docker-compose -f docker/docker-compose.server.yml config

完成后告诉我，我会启动 Agent-1~4 并行执行。
```

---

## Agent-1：ServerAdapter 核心实现（13.1-13.4）

```
你作为 v0.3.0-plan-opus/13-server-mode.md 里的 Agent-1 负责实现 ServerAdapter 核心功能。

请实现 ServerAdapter 的核心 CRUD 操作。

1. 阅读设计文档：
   - v0.3.0/architecture.md §1.1（Server 模式技术栈）
   - packages/storage/src/adapter.ts（StorageAdapter 接口定义）
   - packages/storage/src/lite-adapter.ts（LiteAdapter 实现参考）

2. 任务 13.1 - ServerAdapter 基础框架：
   - 实现 packages/storage/src/server-adapter.ts
   - HTTP/gRPC 客户端配置（连接 storage-backend，v0.3.0 以 HTTP 为主）
   - 错误处理和重试机制
   - 连接池管理

   ```typescript
   export class ServerAdapter implements StorageAdapter {
     private httpClient: HttpClient;
     private config: ServerConfig;

     constructor(config: ServerConfig) {
       this.config = config;
       this.httpClient = new HttpClient({
         baseUrl: config.url,
         timeout: config.timeout || 30000,
         retries: config.retries || 3,
       });
     }

     async init(): Promise<void> {
       // 验证连接
       await this.healthCheck();
     }

     async healthCheck(): Promise<boolean> {
       const response = await this.httpClient.get('/health');
       return response.status === 'ok';
     }
   }
   ```

3. 任务 13.2 - 实体 CRUD 操作：
   - save(): 调用 POST /entities
   - read(): 调用 GET /entities/:id
   - list(): 调用 GET /entities
   - delete(): 调用 DELETE /entities/:id

   ```typescript
   async save(params: SaveParams): Promise<SaveResult> {
     const response = await this.httpClient.post('/entities', {
       body: {
         type: params.type,
         data: params.data,
         metadata: params.metadata,
         proposal_id: params.proposal_id,
       },
     });
     return response.data;
   }

   async read(params: ReadParams): Promise<Entity | null> {
     const response = await this.httpClient.get(`/entities/${params.id}`, {
       query: {
         proposal_id: params.proposal_id,
         include_relations: params.include_relations,
       },
     });
     return response.data;
   }
   ```

4. 任务 13.3 - 关系操作：
   - saveRelation(): 调用 POST /relations
   - deleteRelation(): 调用 DELETE /relations/:id
   - 关系查询集成到 read/list

5. 任务 13.4 - 搜索和图查询：
   - search(): 调用 POST /search（向量搜索）
   - queryDeps(): 调用 POST /graph/deps
   - queryImpact(): 调用 POST /graph/impact

   ```typescript
   async search(params: SearchParams): Promise<SearchResult[]> {
     const response = await this.httpClient.post('/search', {
       body: {
         query: params.query,
         type_filter: params.type_filter,
         proposal_id: params.proposal_id,
         limit: params.limit || 10,
       },
     });
     return response.data.results;
   }
   ```

6. 实现 HTTP 客户端工具（可扩展 gRPC）：
   - packages/storage/src/server-adapter/http-client.ts
   - 请求/响应拦截器
   - 错误码映射（HTTP/gRPC → C4A 错误码）
   - 请求日志

7. 测试用例（packages/storage/src/__tests__/）：
   - server-adapter.test.ts：适配器测试（Mock HTTP）
   - server-adapter-integration.test.ts：集成测试
   - 测试覆盖率要求：核心逻辑 ≥ 80%

8. 错误处理规范：
   - HTTP/gRPC 错误映射到 C4A 错误码
   - 网络超时重试
   - 服务不可用降级提示
```

---

## Agent-2：storage-backend Python 服务（13.5-13.8）

```
你作为 v0.3.0-plan-opus/13-server-mode.md 里的 Agent-2 负责实现 storage-backend Python 服务。

请实现 storage-backend 的核心功能。

ServerAdapter 当前使用的 HTTP 路径：/entities/*、/search、/graph/*、/feat/*、/utils/*、/sync*，storage-backend 路由建议保持一致（见 server-adapter.ts (line 182)）。


1. 阅读设计文档：
   - v0.3.0/architecture.md §1.1（Server 模式：Python 封装数据库访问）
   - v0.3.0/detailed-design/local-mode/sqlite-schema.md（数据模型参考）

2. 任务 13.5 - FastAPI 应用框架：
   - 实现 packages/storage-backend/src/main.py
   - 路由配置
   - 中间件（CORS、日志、错误处理）
   - 健康检查端点

   ```python
   from fastapi import FastAPI, HTTPException
   from contextlib import asynccontextmanager

   @asynccontextmanager
   async def lifespan(app: FastAPI):
       # 启动时初始化数据库连接
       await init_databases()
       yield
       # 关闭时清理连接
       await close_databases()

   app = FastAPI(
       title="C4A Storage Backend",
       version="0.3.0",
       lifespan=lifespan,
   )

   @app.get("/health")
   async def health_check():
       return {
           "status": "ok",
           "mongodb": await check_mongodb(),
           "neo4j": await check_neo4j(),
           "milvus": await check_milvus(),
       }
   ```

3. 任务 13.6 - MongoDB 适配器：
   - 实现 packages/storage-backend/src/adapters/mongodb.py
   - 实体 CRUD 操作
   - **关系 CRUD 操作**（MongoDB 是关系数据的权威源）
   - 索引管理
   - 事务支持

   ```python
   from motor.motor_asyncio import AsyncIOMotorClient
   from pymongo import IndexModel

   class MongoDBAdapter:
       def __init__(self, uri: str, database: str):
           self.client = AsyncIOMotorClient(uri)
           self.db = self.client[database]
           self.entities = self.db["entities"]
           self.relations = self.db["relations"]  # 关系集合（权威源）
           self.metadata = self.db["metadata"]
           self.feats = self.db["feats"]

       async def init_indexes(self):
           # 实体索引
           await self.entities.create_indexes([
               IndexModel([("id", 1), ("source_project", 1), ("proposal_id", 1)], unique=True),
               IndexModel([("type", 1)]),
               IndexModel([("source_project", 1)]),
           ])

           # 关系索引
           await self.relations.create_indexes([
               IndexModel([("id", 1)], unique=True),
               IndexModel([("from_project", 1), ("from_id", 1)]),
               IndexModel([("to_project", 1), ("to_id", 1)]),
               IndexModel([("rel_type", 1)]),
               IndexModel([("proposal_id", 1)]),
           ])

       async def save_entity(self, entity: dict) -> dict:
           # 使用 upsert 保存实体
           result = await self.entities.update_one(
               {
                   "id": entity["id"],
                   "source_project": entity.get("source_project", ""),
                   "proposal_id": entity.get("proposal_id", "")
               },
               {"$set": entity},
               upsert=True,
           )
           return {"id": entity["id"], "upserted": result.upserted_id is not None}

       async def save_relations(self, relations: list[dict]) -> dict:
           """
           保存关系（批量 upsert）

           注意：关系 ID 必须全局唯一，建议格式：
           - {from_project}:{from_id}:{rel_type}:{to_project}:{to_id}:{proposal_id}
           - 或使用 UUID
           """
           if not relations:
               return {"inserted": 0, "modified": 0}

           from pymongo import UpdateOne
           operations = [
               UpdateOne(
                   {"id": r["id"]},
                   {"$set": r},
                   upsert=True
               )
               for r in relations
           ]
           result = await self.relations.bulk_write(operations)
           return {
               "inserted": result.upserted_count,
               "modified": result.modified_count
           }

       async def get_relations_by_entity(self, entity_id: str, project_id: str) -> list[dict]:
           """获取实体相关的所有关系"""
           cursor = self.relations.find({
               "$or": [
                   {"from_id": entity_id, "from_project": project_id},
                   {"to_id": entity_id, "to_project": project_id},
               ]
           })
           return await cursor.to_list(length=None)
   ```

4. 任务 13.7 - Neo4j 适配器：
   - 实现 packages/storage-backend/src/adapters/neo4j.py
   - 节点和关系管理
   - 图遍历查询（deps/impact）
   - Cypher 查询构建

   ```python
   from neo4j import AsyncGraphDatabase

   class Neo4jAdapter:
       # 关系类型白名单（防止 Cypher 注入）
       ALLOWED_REL_TYPES = {
           "DEPENDS_ON", "CONTAINS", "REFERENCES",
           "IMPLEMENTS", "CORRESPONDS", "DERIVES"
       }

       def __init__(self, uri: str, user: str, password: str):
           self.driver = AsyncGraphDatabase.driver(uri, auth=(user, password))

       async def save_relation(self, relation: dict):
           # 验证关系类型（白名单）
           rel_type = relation["rel_type"]
           if rel_type not in self.ALLOWED_REL_TYPES:
               raise ValueError(f"Invalid relation type: {rel_type}")

           async with self.driver.session() as session:
               # 关系类型不能参数化，需要字符串拼接（已白名单校验）
               query = f"""
                   MERGE (from:Entity {{id: $from_id, project: $from_project}})
                   MERGE (to:Entity {{id: $to_id, project: $to_project}})
                   MERGE (from)-[r:{rel_type}]->(to)
                   SET r.proposal_id = $proposal_id,
                       r.properties = $properties
               """
               await session.run(query, **relation)

       async def query_deps(self, entity_id: str, depth: int = 2) -> list:
           # 验证深度参数（防止过深查询）
           if not 1 <= depth <= 10:
               raise ValueError(f"Depth must be between 1 and 10, got {depth}")

           async with self.driver.session() as session:
               # 深度不能参数化，需要字符串拼接（已范围校验）
               query = f"""
                   MATCH path = (start:Entity {{id: $entity_id}})-[:DEPENDS_ON*1..{depth}]->(dep)
                   RETURN dep, length(path) as distance
                   ORDER BY distance
               """
               result = await session.run(query, entity_id=entity_id)
               return [record.data() async for record in result]
   ```

5. 任务 13.8 - Milvus 适配器：
   - 实现 packages/storage-backend/src/adapters/milvus.py
   - 向量索引管理
   - 相似度搜索
   - Embedding 生成（通过 EmbeddingService）

   ```python
   import asyncio
   from pymilvus import MilvusClient, DataType

   class MilvusAdapter:
       def __init__(self, uri: str, collection: str = "c4a_vectors", dimension: int = 768):
           self.client = MilvusClient(uri=uri)
           self.collection = collection
           self.dimension = dimension  # 由 EmbeddingService 决定

       async def init_collection(self):
           # MilvusClient 是同步的，使用 asyncio.to_thread 包装
           await asyncio.to_thread(self._init_collection_sync)

       def _init_collection_sync(self):
           # 创建集合（同步方法）
           if not self.client.has_collection(self.collection):
               self.client.create_collection(
                   collection_name=self.collection,
                   dimension=self.dimension,  # Ollama: 768, OpenAI: 1536
                   metric_type="COSINE",
               )

       async def search(self, query_vector: list, limit: int = 10, filter_expr: str = None) -> list:
           # 使用 asyncio.to_thread 包装同步调用
           return await asyncio.to_thread(
               self._search_sync, query_vector, limit, filter_expr
           )

       def _search_sync(self, query_vector: list, limit: int, filter_expr: str = None) -> list:
           results = self.client.search(
               collection_name=self.collection,
               data=[query_vector],
               limit=limit,
               filter=filter_expr,
               output_fields=["entity_id", "proposal_id"],
           )
           return results[0] if results else []
   ```

   > **注意**：`pymilvus.MilvusClient` 是同步客户端，使用 `asyncio.to_thread()` 包装避免阻塞事件循环。

6. 任务 13.8.1 - Embedding 服务：
   - 实现 packages/storage-backend/src/services/embedding.py
   - **默认使用 Ollama**（本地开发无需 API Key）
   - 可选使用 OpenAI（生产环境更高质量）

   ```python
   import os
   import httpx
   from abc import ABC, abstractmethod

   class EmbeddingProvider(ABC):
       @abstractmethod
       async def embed(self, text: str) -> list[float]:
           pass

       @property
       @abstractmethod
       def dimension(self) -> int:
           pass

   class OllamaEmbedding(EmbeddingProvider):
       """默认 Embedding 提供者（本地运行，无需 API Key）"""

       def __init__(self, host: str = None, model: str = "nomic-embed-text"):
           # Docker 内默认使用容器 DNS，本地开发使用 localhost
           default_host = os.getenv("OLLAMA_HOST", "http://ollama:11434")
           self.host = host or default_host
           self.model = model

       async def embed(self, text: str) -> list[float]:
           async with httpx.AsyncClient() as client:
               response = await client.post(
                   f"{self.host}/api/embeddings",
                   json={"model": self.model, "prompt": text},
               )
               return response.json()["embedding"]

       @property
       def dimension(self) -> int:
           return 768  # nomic-embed-text

   class OpenAIEmbedding(EmbeddingProvider):
       """可选 Embedding 提供者（更高质量，需要 API Key）"""

       def __init__(self, api_key: str = None, model: str = "text-embedding-3-small"):
           from openai import AsyncOpenAI
           self.client = AsyncOpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))
           self.model = model

       async def embed(self, text: str) -> list[float]:
           response = await self.client.embeddings.create(
               model=self.model,
               input=text,
           )
           return response.data[0].embedding

       @property
       def dimension(self) -> int:
           return 1536  # text-embedding-3-small

   class EmbeddingService:
       """
       Embedding 服务工厂
       优先级: OPENAI_API_KEY > OLLAMA_HOST (Docker 默认 http://ollama:11434)

       注意：
       - Docker 部署时默认使用容器 DNS http://ollama:11434
       - 本地开发需设置 OLLAMA_HOST=http://localhost:11434
       """

       _instance: EmbeddingProvider | None = None

       @classmethod
       def get_provider(cls) -> EmbeddingProvider:
           if cls._instance is None:
               if os.getenv("OPENAI_API_KEY"):
                   cls._instance = OpenAIEmbedding()
               else:
                   # 默认使用 Ollama（本地开发友好）
                   cls._instance = OllamaEmbedding()
           return cls._instance

       @classmethod
       def get_dimension(cls) -> int:
           return cls.get_provider().dimension
   ```

   **Embedding 配置说明**：

   | 环境变量 | 提供者 | 维度 | 适用场景 |
   |---------|--------|:----:|---------|
   | 无（默认） | Ollama (nomic-embed-text) | 768 | Docker 部署（默认 `http://ollama:11434`） |
   | `OLLAMA_HOST=http://localhost:11434` | Ollama | 768 | 本地开发 |
   | `OPENAI_API_KEY` | OpenAI (text-embedding-3-small) | 1536 | 生产环境（可选） |

   > **注意**：
   > - Docker 内默认使用容器 DNS `http://ollama:11434`
   > - 本地开发需设置 `OLLAMA_HOST=http://localhost:11434`
   > - 切换 Embedding 提供者会改变向量维度，需要重建 Milvus Collection

7. 实现 API 路由：
   - packages/storage-backend/src/routes/entities.py
   - packages/storage-backend/src/routes/relations.py
   - packages/storage-backend/src/routes/search.py
   - packages/storage-backend/src/routes/graph.py

8. 测试用例：
   - test_mongodb.py：MongoDB 适配器测试
   - test_neo4j.py：Neo4j 适配器测试
   - test_milvus.py：Milvus 适配器测试
   - test_api.py：API 端点测试
   - 测试覆盖率要求：核心逻辑 ≥ 80%

9. 错误处理规范：
   - 数据库连接失败处理
   - 事务回滚机制
   - 错误码映射到 C4A 错误码
```

---

## Agent-3：权限系统实现（13.9-13.12）

```
你作为 v0.3.0-plan-opus/13-server-mode.md 里的 Agent-3 负责实现权限系统。

请实现 Server 模式的权限检查功能。

1. 阅读设计文档：
   - v0.3.0/detailed-design/permissions/cross-project-auth.md（权限控制详细设计）
   - v0.3.0/detailed-design/permissions/error-codes.md（错误码定义）

2. 任务 13.9 - 权限数据模型：
   - 实现 packages/storage-backend/src/models/permission.py
   - MongoDB 集合：project_permissions
   - 用户角色：admin / writer / reader

   ```python
   from pydantic import BaseModel
   from datetime import datetime
   from enum import Enum

   class Role(str, Enum):
       ADMIN = "admin"
       WRITER = "writer"
       READER = "reader"

   class ProjectPermission(BaseModel):
       project_id: str
       user_id: str
       role: Role
       granted_at: datetime
       granted_by: str | None = None

   class PermissionCheck(BaseModel):
       user_id: str
       project_id: str
       action: str  # "read" | "write" | "approve"
   ```

3. 任务 13.10 - 权限检查服务：
   - 实现 packages/storage-backend/src/services/permission.py
   - checkRead(): 检查读权限
   - checkWrite(): 检查写权限
   - checkApprove(): 检查批准权限
   - listPermissions(): 列出项目权限

   ```python
   class PermissionService:
       def __init__(self, mongodb: MongoDBAdapter):
           self.permissions = mongodb.db["project_permissions"]

       async def check_permission(
           self, user_id: str, project_id: str, action: str
       ) -> bool:
           permission = await self.permissions.find_one({
               "user_id": user_id,
               "project_id": project_id,
           })

           if not permission:
               return False

           role = permission["role"]

           if action == "read":
               return role in ["admin", "writer", "reader"]
           elif action == "write":
               return role in ["admin", "writer"]
           elif action == "approve":
               return role == "admin"

           return False

       async def list_permissions(self, project_id: str) -> list[dict]:
           """列出项目的所有权限"""
           cursor = self.permissions.find({"project_id": project_id})
           return await cursor.to_list(length=None)

       async def get_user_projects(self, user_id: str) -> list[str]:
           """获取用户有权限的项目列表（用于搜索过滤）"""
           cursor = self.permissions.find({"user_id": user_id})
           permissions = await cursor.to_list(length=None)
           return [p["project_id"] for p in permissions]

       async def check_cross_project_publish(
           self, user_id: str, project_ids: list[str]
       ) -> dict:
           """检查跨项目发布权限"""
           results = {"allowed": True, "missing": []}

           for project_id in project_ids:
               has_permission = await self.check_permission(
                   user_id, project_id, "approve"
               )
               if not has_permission:
                   results["allowed"] = False
                   results["missing"].append(project_id)

           return results
   ```

4. 任务 13.11 - 权限中间件：
   - 实现 packages/storage-backend/src/middleware/auth.py
   - JWT Token 验证（v0.3.0 简化：信任 Header）
   - 用户上下文注入

   ```python
   from fastapi import Request, HTTPException
   from starlette.middleware.base import BaseHTTPMiddleware

   class AuthMiddleware(BaseHTTPMiddleware):
       async def dispatch(self, request: Request, call_next):
           # v0.3.0 简化：从 Header 获取用户 ID
           user_id = request.headers.get("X-User-ID")

           if not user_id:
               # 允许匿名访问（v0.3.0 暂不强制认证）
               user_id = "anonymous"

           request.state.user_id = user_id
           response = await call_next(request)
           return response
   ```

5. 任务 13.12 - 权限 API 端点与强制校验：
   - 实现 packages/storage-backend/src/routes/permissions.py
   - **在所有写操作路由中强制校验权限**（安全关键）
   - GET /permissions/{project_id}：查询项目权限
   - POST /permissions：授予权限
   - DELETE /permissions：撤销权限
   - POST /permissions/check：检查权限

   **统一依赖注入方式**（推荐）：

   ```python
   # packages/storage-backend/src/dependencies.py
   from fastapi import Depends, Request, HTTPException
   from .services.permission import PermissionService
   from .adapters.mongodb import MongoDBAdapter

   # 全局单例（在 main.py 的 lifespan 中初始化）
   _mongodb: MongoDBAdapter | None = None
   _permission_service: PermissionService | None = None

   def init_services(mongodb: MongoDBAdapter):
       """在应用启动时调用"""
       global _mongodb, _permission_service
       _mongodb = mongodb
       _permission_service = PermissionService(mongodb)

   def get_permission_service() -> PermissionService:
       if _permission_service is None:
           raise RuntimeError("Services not initialized")
       return _permission_service

   def get_mongodb() -> MongoDBAdapter:
       if _mongodb is None:
           raise RuntimeError("Services not initialized")
       return _mongodb
   ```

   **权限校验依赖函数**（替代装饰器，更可靠）：

   ```python
   # packages/storage-backend/src/dependencies.py (续)

   async def get_current_user(request: Request) -> str:
       """从请求中获取当前用户 ID"""
       user_id = request.headers.get("X-User-ID", "anonymous")
       return user_id

   async def require_write_permission(
       project_id: str,
       user_id: str = Depends(get_current_user),
       permission_service: PermissionService = Depends(get_permission_service),
   ) -> str:
       """
       写权限校验依赖函数（适用于 path/query 中有 project_id 的路由）
       用法: user_id: str = Depends(require_write_permission)
       """
       allowed = await permission_service.check_permission(user_id, project_id, "write")
       if not allowed:
           raise HTTPException(
               status_code=403,
               detail={
                   "code": "C4A-PERM-002",
                   "message": "无写权限",
                   "user_id": user_id,
                   "project_id": project_id,
               }
           )
       return user_id

   async def check_entity_permission(
       entity: "EntityCreate",  # 从 body 获取
       user_id: str = Depends(get_current_user),
       permission_service: PermissionService = Depends(get_permission_service),
   ) -> str:
       """
       实体写权限校验（从 body 中提取 project_id）
       """
       # 优先从 source_project 获取，兜底从 metadata 获取
       project_id = entity.source_project
       if not project_id and hasattr(entity, 'metadata') and entity.metadata:
           project_id = entity.metadata.get("source_project", "")

       if not project_id:
           raise HTTPException(400, detail={"code": "C4A-DATA-001", "message": "缺少 project_id"})

       allowed = await permission_service.check_permission(user_id, project_id, "write")
       if not allowed:
           raise HTTPException(
               status_code=403,
               detail={
                   "code": "C4A-PERM-002",
                   "message": "无写权限",
                   "user_id": user_id,
                   "project_id": project_id,
               }
           )
       return user_id

   async def check_read_permission(
       project_id: str,
       user_id: str = Depends(get_current_user),
       permission_service: PermissionService = Depends(get_permission_service),
   ) -> str:
       """
       读权限校验（v0.3.0 默认拒绝匿名读，可配置放开）
       """
       # v0.3.0 简化：匿名默认拒绝
       if user_id == "anonymous":
           raise HTTPException(403, detail={"code": "C4A-PERM-001", "message": "无读权限"})

       allowed = await permission_service.check_permission(user_id, project_id, "read")
       if not allowed:
           raise HTTPException(403, detail={"code": "C4A-PERM-001", "message": "无读权限"})
       return user_id

   async def get_user_visible_projects(
       user_id: str = Depends(get_current_user),
       permission_service: PermissionService = Depends(get_permission_service),
   ) -> list[str]:
       """
       获取用户可见项目列表（用于搜索/列表过滤）

       v0.3.0 策略：
       - 匿名用户：返回空列表（无权限查看任何项目）
       - 认证用户：返回有权限的项目列表
       """
       if user_id == "anonymous":
           return []  # 匿名用户无可见项目
       return await permission_service.get_user_projects(user_id)
   ```

   **应用到实体路由**：

   ```python
   # packages/storage-backend/src/routes/entities.py
   from fastapi import APIRouter, Depends, HTTPException
   from ..dependencies import (
       get_mongodb, get_current_user,
       check_entity_permission, check_read_permission,
       get_user_visible_projects
   )
   from ..models.entity import EntityCreate
   from ..services.permission import PermissionService

   router = APIRouter(prefix="/entities", tags=["entities"])

   @router.post("/")
   async def create_entity(
       entity: EntityCreate,
       user_id: str = Depends(check_entity_permission),  # 权限校验 + 获取 user_id
       mongodb: MongoDBAdapter = Depends(get_mongodb),
   ):
       # 权限已校验，直接执行业务逻辑
       result = await mongodb.entities.insert_one(entity.model_dump())
       return {"id": entity.id, "created": True}

   @router.get("/{entity_id}")
   async def get_entity(
       entity_id: str,
       project_id: str,  # 查询参数，强制指定项目
       user_id: str = Depends(get_current_user),
       permission_service: PermissionService = Depends(get_permission_service),
       mongodb: MongoDBAdapter = Depends(get_mongodb),
   ):
       # 先查询实体（按项目过滤，避免跨项目读取）
       entity = await mongodb.entities.find_one({
           "id": entity_id,
           "source_project": project_id
       })
       if not entity:
           raise HTTPException(404, detail={"code": "C4A-DATA-002", "message": "实体不存在"})

       # 校验读权限（匿名默认拒绝，可配置放开）
       if user_id == "anonymous":
           raise HTTPException(403, detail={"code": "C4A-PERM-001", "message": "无读权限"})

       allowed = await permission_service.check_permission(user_id, project_id, "read")
       if not allowed:
           raise HTTPException(403, detail={"code": "C4A-PERM-001", "message": "无读权限"})

       return entity

   @router.delete("/{entity_id}")
   async def delete_entity(
       entity_id: str,
       user_id: str = Depends(get_current_user),
       permission_service: PermissionService = Depends(get_permission_service),
       mongodb: MongoDBAdapter = Depends(get_mongodb),
   ):
       # 先查询实体获取所属项目（防止跨项目删除）
       entity = await mongodb.entities.find_one({"id": entity_id})
       if not entity:
           raise HTTPException(404, detail={"code": "C4A-DATA-002", "message": "实体不存在"})

       project_id = entity.get("source_project", "")
       if not project_id:
           raise HTTPException(400, detail={"code": "C4A-DATA-001", "message": "实体缺少 project_id"})

       # 校验权限（必须有该项目的写权限）
       allowed = await permission_service.check_permission(user_id, project_id, "write")
       if not allowed:
           raise HTTPException(403, detail={"code": "C4A-PERM-002", "message": "无写权限"})

       # 删除实体（带项目过滤，双重保险）
       result = await mongodb.entities.delete_one({
           "id": entity_id,
           "source_project": project_id
       })

       if result.deleted_count == 0:
           raise HTTPException(404, detail={"code": "C4A-DATA-002", "message": "实体不存在或已删除"})

       return {"id": entity_id, "deleted": True}

   @router.get("/")
   async def list_entities(
       project_ids: list[str] = Depends(get_user_visible_projects),  # 自动过滤可见项目
       type: str = None,  # 可选过滤条件
       limit: int = 100,
       mongodb: MongoDBAdapter = Depends(get_mongodb),
   ):
       """
       列出实体（按用户可见项目过滤）

       v0.3.0 策略：
       - 匿名用户：返回空列表
       - 认证用户：仅返回有权限项目的实体
       """
       if not project_ids:
           return {"entities": [], "total": 0}

       query = {"source_project": {"$in": project_ids}}
       if type:
           query["type"] = type

       cursor = mongodb.entities.find(query).limit(limit)
       entities = await cursor.to_list(length=limit)
       return {"entities": entities, "total": len(entities)}
   ```

   > **注意**：search/graph 路由同样应依赖 `get_user_visible_projects`，
   > 并按 `project_ids` 过滤查询结果，避免越权。

   **权限 API 端点**：

   ```python
   # packages/storage-backend/src/routes/permissions.py
   from fastapi import APIRouter, Depends
   from ..dependencies import get_permission_service
   from ..services.permission import PermissionService
   from ..models.permission import PermissionCheck

   router = APIRouter(prefix="/permissions", tags=["permissions"])

   @router.post("/check")
   async def check_permission(
       check: PermissionCheck,
       permission_service: PermissionService = Depends(get_permission_service),
   ):
       allowed = await permission_service.check_permission(
           check.user_id, check.project_id, check.action
       )
       return {"allowed": allowed}

   @router.get("/{project_id}")
   async def get_project_permissions(
       project_id: str,
       permission_service: PermissionService = Depends(get_permission_service),
   ):
       permissions = await permission_service.list_permissions(project_id)
       return {"permissions": permissions}
   ```

   **读权限策略说明**：

   | 操作类型 | v0.3.0 策略 | 实现方式 |
   |---------|------------|---------|
   | 写操作 (POST/PUT/DELETE) | **强制校验** | 必须有 write 权限，先查实体获取 project_id 再校验 |
   | 读操作 (GET 单个) | 默认校验（匿名拒绝，可配置放开） | 要求 project_id 参数 + 读权限校验 |
   | 列表/搜索 | **按项目过滤** | 仅返回用户有权限的项目的实体 |
   | 图查询 | **按项目过滤** | 仅遍历用户有权限的项目的关系 |

   **搜索过滤策略**：

   | 用户类型 | 可见项目 | 搜索结果 |
   |---------|---------|---------|
   | 匿名用户 | 无 | 空列表 |
   | 认证用户 | 通过 `get_user_projects()` 获取 | 仅返回有权限项目的实体 |

   > **v0.3.0 简化**：
   > - 单个实体读取默认需要权限校验（可配置为放开）
   > - 列表/搜索强制按用户权限过滤，防止数据泄露
   > - 匿名用户无法查看任何项目数据

6. ServerAdapter 提前失败优化（可选）：
   - 更新 packages/storage/src/server-adapter.ts
   - 在 save/delete 操作前**可选地**调用权限检查（提前失败，减少网络开销）
   - **后端仍会强制校验**，这只是客户端优化
   - 权限错误映射到 C4A-PERM-* 错误码

   ```typescript
   // packages/storage/src/server-adapter.ts
   async save(params: SaveParams): Promise<SaveResult> {
     // 可选：提前检查权限（减少无效请求）
     if (this.config.checkPermissionBeforeRequest) {
       const allowed = await this.checkPermission(params.project_id, "write");
       if (!allowed) {
         throw new PermissionError("C4A-PERM-002", "无写权限");
       }
     }

     // 发送请求（后端会再次强制校验）
     const response = await this.httpClient.post('/entities', { body: params });
     return response.data;
   }
   ```

7. 测试用例：
   - test_permission.py：权限服务测试
   - test_auth_middleware.py：中间件测试
   - test_permission_api.py：API 端点测试
   - 测试覆盖率要求：核心逻辑 ≥ 80%

8. 错误处理规范：
   - C4A-PERM-001：无读权限
   - C4A-PERM-002：无写权限
   - C4A-PERM-003：无批准权限
   - C4A-PERM-004：跨项目发布权限不足
```

---

## Agent-4：模式切换和 CLI 完善（13.13-13.20）

```
你作为 v0.3.0-plan-opus/13-server-mode.md 里的 Agent-4 负责实现模式切换和 CLI 完善。

请实现 Local↔Server 模式切换和 CLI 命令完善。

1. 阅读设计文档：
   - v0.3.0/detailed-design/local-mode/mode-switch.md（模式切换机制）
   - v0.3.0/detailed-design/cli/user-cli.md §2.4（c4a server 子菜单）
   - v0.3.0/detailed-design/mcp/store-utils.md（备份/恢复工具）

2. 任务 13.13 - Local→Server 切换：
   - 完善 packages/storage/src/modeSwitchBackup.ts
   - 实现 Server 端数据导入
   - 冲突处理策略（skip/override/merge/error）

   ```typescript
   export async function migrateLocalToServer(
     backupPath: string,
     serverAdapter: ServerAdapter,
     options: MigrateOptions
   ): Promise<MigrateResult> {
     // 1. 读取备份文件
     const backup = await readBackup(backupPath);

     // 2. 验证版本兼容性
     if (!isCompatible(backup.version, CURRENT_VERSION)) {
       throw new MigrationError('C4A-MIGRATE-001', '版本不兼容');
     }

     // 3. 导入实体（带冲突处理）
     const results = { success: [], failed: [], skipped: [] };

     for (const entity of backup.entities) {
       try {
         const existing = await serverAdapter.read({ id: entity.id });

         if (existing) {
           // 处理冲突
           const resolution = await handleConflict(
             existing, entity, options.conflictPolicy
           );
           if (resolution === 'skip') {
             results.skipped.push(entity.id);
             continue;
           }
         }

         await serverAdapter.save(entity);
         results.success.push(entity.id);
       } catch (err) {
         results.failed.push({ id: entity.id, error: err.message });
       }
     }

     // 4. 导入关系
     for (const relation of backup.relations) {
       await serverAdapter.saveRelation(relation);
     }

     return results;
   }
   ```

3. 任务 13.14 - Server→Local 切换：
   - 完善 packages/storage/src/modeSwitchRestore.ts
   - 从 Server 导出数据
   - 向量索引重建

   ```typescript
   export async function migrateServerToLocal(
     serverAdapter: ServerAdapter,
     liteAdapter: LiteAdapter,
     options: MigrateOptions
   ): Promise<MigrateResult> {
     // 1. 从 Server 导出数据
     const backup = await serverAdapter.backup({
       statusFilter: options.statusFilter || 'published',
     });

     // 2. 导入到 Local
     const results = await liteAdapter.restore(backup, {
       conflictPolicy: options.conflictPolicy,
     });

     // 3. 重建向量索引
     if (options.rebuildVectors !== false) {
       await liteAdapter.rebuildVectorIndex({
         background: options.background,
         onProgress: options.onProgress,
       });
     }

     return results;
   }
   ```

4. 任务 13.15 - 权限校验集成：
   - 迁移时检查目标项目权限
   - 权限不足时的处理策略
   - 权限预检查命令

5. 任务 13.16 - 进度回调和错误恢复：
   - 大数据量迁移进度显示
   - 断点续传支持
   - 失败回滚机制

6. 任务 13.17 - c4a server status 完善：
   - 显示 Docker 容器状态
   - 显示各服务健康状态
   - 显示连接信息

   ```typescript
   // packages/cli/src/commands/server.ts
   export async function serverStatus(): Promise<void> {
     const containers = await getContainerStatus([
       'c4a-mongodb',
       'c4a-neo4j',
       'c4a-milvus',
       'c4a-storage-backend',
     ]);

     console.log('Server 模式状态:');
     for (const container of containers) {
       const status = container.running ? '✅' : '❌';
       console.log(`  ${status} ${container.name}: ${container.status}`);
     }

     // 健康检查
     const health = await checkServerHealth();
     console.log('\n服务健康状态:');
     console.log(`  MongoDB: ${health.mongodb ? '✅' : '❌'}`);
     console.log(`  Neo4j: ${health.neo4j ? '✅' : '❌'}`);
     console.log(`  Milvus: ${health.milvus ? '✅' : '❌'}`);
   }
   ```

7. 任务 13.18 - c4a server backup/restore 完善：
   - 调用 c4a_store_backup MCP 工具
   - 进度显示
   - 错误处理

8. 任务 13.19 - c4a server check-permissions：
   - 检查备份文件中实体的权限兼容性
   - 显示可导入/无权限的实体统计

9. 任务 13.20 - c4a install server 完善：
   - Docker 安装检查
   - 服务启动和健康检查
   - 配置写入

10. 测试用例：
    - mode-switch.test.ts：模式切换测试
    - server-commands.test.ts：CLI 命令测试
    - 测试覆盖率要求：核心逻辑 ≥ 80%

11. 错误处理规范：
    - C4A-MIGRATE-001：版本不兼容
    - C4A-MIGRATE-002：数据格式错误
    - C4A-MIGRATE-003：权限不足
    - C4A-MIGRATE-004：连接失败
```

---

## Agent-5：集成收尾（等待 Agent-1~4 全部完成）

```
你作为 v0.3.0-plan-opus/13-server-mode.md 里的 Agent-5 负责实现集成收尾任务。

请执行 Part 13 Server Mode 的集成收尾任务。

1. 阅读设计文档：
   - v0.3.0/architecture.md（确认所有模块已实现）
   - v0.3.0/detailed-design/local-mode/mode-switch.md（确认切换流程正确）

2. 集成任务：

   **更新 getAdapter() 工厂函数**：
   - packages/storage/src/get-adapter.ts
   - 根据 mode 配置返回 LiteAdapter 或 ServerAdapter
   - 连接验证

   ```typescript
   export async function getAdapter(config: C4AConfig): Promise<StorageAdapter> {
     const mode = config.mode || 'local';

     if (mode === 'local') {
       const adapter = new LiteAdapter(config.local);
       await adapter.init();
       return adapter;
     }

     if (mode === 'server' || mode === 'remote') {
       const serverConfig = mode === 'server' ? config.server : config.remote;
       const adapter = new ServerAdapter(serverConfig);
       await adapter.init();
       return adapter;
     }

     throw new Error(`Unknown mode: ${mode}`);
   }
   ```

   **更新 MCP Server**：
   - packages/mcp-store/src/server.ts
   - 使用 getAdapter() 获取适配器
   - 确保所有工具支持 Server 模式

   **更新 Docker Compose**：
   - docker/docker-compose.server.yml
   - 完整的服务编排
   - 健康检查配置
   - 网络配置

3. 端到端测试：
   - 启动 Server 模式服务
   - 测试完整的 CRUD 流程
   - 测试模式切换流程
   - 测试权限检查流程

4. 创建集成测试：
   - packages/storage/src/__tests__/server-integration.test.ts
   - 端到端测试：init → save → read → search → delete
   - 模式切换测试：Local → Server → Local
   - 权限测试：无权限 → 授权 → 有权限

5. 文档更新：
   - 更新 packages/storage/README.md
   - 添加 Server 模式使用说明
   - 添加 Docker 部署说明

6. 验证清单：
   - [x] ServerAdapter 实现完整
     - 验证命令：`bun run --filter @c4a/storage test`
   - [x] storage-backend 服务可用
     - 验证命令：`docker-compose -f docker/docker-compose.server.yml up -d && curl http://localhost:8055/health`
   - [x] MongoDB 适配器正常
   - [x] Neo4j 适配器正常
   - [x] Milvus 适配器正常
   - [x] Embedding 服务正常（Ollama 默认）
   - [x] 权限检查正常
   - [x] Local→Server 切换正常
   - [x] Server→Local 切换正常
   - [x] c4a server 命令正常
   - [x] c4a install server 正常

7. 产物：
   - packages/storage/src/server-adapter.ts 完整实现
   - packages/storage-backend/ Python 服务
   - docker/docker-compose.server.yml 更新
   - MCP 容器内联配置：改用 `C4A_STORAGE_BACKEND_URL`，移除 `docker/c4a.server.yaml`
   - 集成测试通过
   - README 文档更新
```

---

## 执行检查清单

| 步骤 | Agent | 任务编号 | 状态 | 完成时间 |
|------|-------|---------|:----:|---------|
| 0 | Agent-0 | 前置准备 + 目录创建 | [x] | 2026-01-31 |
| 1 | Agent-1 | 13.1-13.4 (ServerAdapter) | [x] | 2026-02-01 |
| 1 | Agent-2 | 13.5-13.8.1 (storage-backend) | [x] | 2026-02-01 |
| 1 | Agent-3 | 13.9-13.12 (权限系统) | [x] | 2026-02-01 |
| 1 | Agent-4 | 13.13-13.20 (模式切换+CLI) | [x] | 2026-02-01 |
| 2 | Agent-5 | 集成收尾 | [x] | 2026-02-01 |

---

## 任务编号索引

| 编号 | 任务 | Agent |
|------|------|-------|
| 13.1 | ServerAdapter 基础框架 | Agent-1 |
| 13.2 | 实体 CRUD 操作 | Agent-1 |
| 13.3 | 关系操作 | Agent-1 |
| 13.4 | 搜索和图查询 | Agent-1 |
| 13.5 | FastAPI 应用框架 | Agent-2 |
| 13.6 | MongoDB 适配器 | Agent-2 |
| 13.7 | Neo4j 适配器 | Agent-2 |
| 13.8 | Milvus 适配器 | Agent-2 |
| 13.8.1 | Embedding 服务 (Ollama/OpenAI) | Agent-2 |
| 13.9 | 权限数据模型 | Agent-3 |
| 13.10 | 权限检查服务 | Agent-3 |
| 13.11 | 权限中间件 | Agent-3 |
| 13.12 | 权限 API 端点 | Agent-3 |
| 13.13 | Local→Server 切换 | Agent-4 |
| 13.14 | Server→Local 切换 | Agent-4 |
| 13.15 | 权限校验集成 | Agent-4 |
| 13.16 | 进度回调和错误恢复 | Agent-4 |
| 13.17 | c4a server status 完善 | Agent-4 |
| 13.18 | c4a server backup/restore 完善 | Agent-4 |
| 13.19 | c4a server check-permissions | Agent-4 |
| 13.20 | c4a install server 完善 | Agent-4 |
| 13.21 | storage-backend 目录创建 | Agent-0 |
| 13.22 | ServerAdapter 占位更新 | Agent-0 |

---

## 关键设计决策

### 1. Server 模式架构

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP Server (TypeScript)                  │
│                                                             │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│   │ mcp-store   │    │ mcp-query   │    │ mcp-visual  │    │
│   └──────┬──────┘    └──────┬──────┘    └─────────────┘    │
│          │                  │                               │
│          └────────┬─────────┘                               │
│                   │                                         │
│          ┌────────▼────────┐                                │
│          │  ServerAdapter  │                                │
│          │   (TypeScript)  │                                │
│          └────────┬────────┘                                │
│                   │ HTTP/gRPC                               │
└───────────────────┼─────────────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────────────┐
│              storage-backend (Python/FastAPI)                │
│                                                             │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│   │  MongoDB    │  │   Neo4j     │  │   Milvus    │        │
│   │  Adapter    │  │   Adapter   │  │   Adapter   │        │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│          │                │                │                │
└──────────┼────────────────┼────────────────┼────────────────┘
           │                │                │
    ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
    │   MongoDB   │  │    Neo4j    │  │   Milvus    │
    │   :27017    │  │ :7474/:7687 │  │   :19530    │
    └─────────────┘  └─────────────┘  └─────────────┘
```

**说明**：Server 模式 MCP Server 层仍是 TypeScript，ServerAdapter 通过 HTTP/gRPC 调用 Python storage-backend。采用 Python 的原因是 MongoDB/Neo4j/Milvus 的 Python 驱动更成熟稳定，便于快速落地。

### 2. 数据一致性策略

**v0.3.0 采用同步写入策略**（简单可靠）：

| 数据库 | 角色 | 存储内容 |
|--------|------|----------|
| MongoDB | **权威数据源** | 实体 + 关系 + 元数据 |
| Neo4j | 图查询索引 | 节点 + 关系（从 MongoDB 可重建） |
| Milvus | 向量搜索索引 | 向量（从实体内容可重建） |

**写入流程**（最佳努力补偿）：

```python
async def save_entity_with_relations(entity, relations):
    """
    同步写入三库，采用最佳努力补偿策略

    注意：这不是真正的分布式事务，而是"最佳努力补偿"：
    - 按顺序写入 MongoDB → Neo4j → Milvus
    - 任一步骤失败时，尝试回滚已完成的步骤
    - 回滚失败时记录日志并告警，需人工介入
    """
    entity_id = entity["id"]
    source_project = entity.get("source_project", "")
    written_to = []  # 记录已写入的数据库

    try:
        # 1. 写入 MongoDB（实体 + 关系）
        await mongodb.entities.insert_one(entity)
        written_to.append("mongodb_entity")

        if relations:
            # 记录关系 ID 用于精确回滚
            relation_ids = [r["id"] for r in relations]
            await mongodb.relations.insert_many(relations)
            written_to.append(("mongodb_relations", relation_ids))

        # 2. 写入 Neo4j（图结构）
        await neo4j.create_nodes_and_edges(entity, relations)
        written_to.append("neo4j")

        # 3. 写入 Milvus（向量）
        embedding = await embedding_service.embed(entity_to_text(entity))
        await milvus.insert(entity_id, source_project, embedding)
        written_to.append("milvus")

    except Exception as e:
        # 最佳努力回滚
        await _rollback_writes(entity_id, source_project, written_to, relations)
        raise e


async def _rollback_writes(entity_id: str, source_project: str, written_to: list, relations: list):
    """
    最佳努力回滚，回滚失败时记录日志

    注意：回滚本身可能失败，此时记录日志供人工处理
    """
    rollback_errors = []

    for item in reversed(written_to):
        try:
            if item == "mongodb_entity":
                await mongodb.entities.delete_one({
                    "id": entity_id,
                    "source_project": source_project
                })
            elif isinstance(item, tuple) and item[0] == "mongodb_relations":
                relation_ids = item[1]
                await mongodb.relations.delete_many({"id": {"$in": relation_ids}})
            elif item == "neo4j":
                await neo4j.delete_node(entity_id, source_project)
            elif item == "milvus":
                await milvus.delete(entity_id, source_project)
        except Exception as rollback_err:
            rollback_errors.append({
                "target": item,
                "error": str(rollback_err),
                "entity_id": entity_id,
            })

    if rollback_errors:
        # 记录回滚失败日志，需人工介入
        logger.error(f"Rollback failed for entity {entity_id}: {rollback_errors}")
        # 可选：发送告警
        await alert_service.send_rollback_failure(entity_id, rollback_errors)
```

**一致性保证说明**：

| 场景 | 处理方式 | 数据状态 |
|------|---------|---------|
| MongoDB 写入失败 | 直接抛出异常 | 无数据写入 |
| Neo4j 写入失败 | 回滚 MongoDB | 无数据写入 |
| Milvus 写入失败 | 回滚 MongoDB + Neo4j | 无数据写入 |
| 回滚失败 | 记录日志 + 告警 | **需人工介入** |

> **重要**：这是"最佳努力补偿"而非 ACID 事务。回滚失败时会产生数据不一致，
> 需要通过 `c4a_store_repair` 工具或人工介入修复。

**备份/恢复流程**：

| 操作 | 数据来源 | 说明 |
|------|---------|------|
| 备份 | MongoDB | 导出 entities + relations 集合 |
| 恢复 | MongoDB → Neo4j/Milvus | 先恢复 MongoDB，再重建索引 |

**设计理由**：
- v0.3.0 优先保证正确性，同步写入简单可靠
- MongoDB 存储关系数据，支持完整备份/恢复
- Neo4j/Milvus 作为索引可从 MongoDB 重建
- 后续版本可优化为异步写入（需要消息队列）

### 3. 权限检查时机

| 操作 | 检查时机 | 检查内容 |
|------|---------|---------|
| 创建实体 | 立即 | 目标项目写权限 |
| 修改实体 | 立即 | 实体所属项目写权限 |
| 删除实体 | 立即 | 实体所属项目写权限 |
| 发布 feat | 发布时 | 所有涉及项目批准权限 |

### 4. 模式切换策略

| 切换方向 | 数据迁移 | 向量处理 |
|---------|---------|---------|
| Local → Server | backup → restore | 不导出，Server 端重建 |
| Server → Local | backup → restore | 不导出，Local 端重建 |

---

## 挂起任务

| 任务 | 挂起原因 | 解除条件 |
|------|----------|----------|
| JWT 认证 | v0.3.0 简化设计 | v0.4.0 版本 |
| 异步多方审批 | v0.3.0 简化设计 | v0.4.0 版本 |
| 分布式事务 | 复杂度高 | 需求明确后 |

---

## 依赖关系图

```
┌─────────────────────────────────────────────────────────────┐
│                    Part 13 Server Mode                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  依赖:                                                       │
│  ├── Part 06 Local Mode (StorageAdapter 接口)               │
│  ├── Part 07 Data Ops (sync/export 引擎)                    │
│  └── Part 08 User CLI (命令框架)                            │
│                                                             │
│  被依赖:                                                     │
│  └── Part 11 Permissions (权限系统基础)                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```
