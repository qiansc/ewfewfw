/**
 * C4 架构图生成工具
 *
 * 从 Neo4j 查询架构数据，生成 C4 架构图
 */
import type { C4Entity, C4Relationship } from "../renderers/mermaid.js";
import { generateC4Diagram, renderMermaid } from "../renderers/mermaid.js";
import { saveImage } from "../storage/storage-manager.js";
import { config } from "../config.js";

export interface RenderC4Input {
  level: "context" | "container" | "component";
  entity_id?: string;
  output_format: "svg" | "png";
  theme?: string;
  storage_mode?: "cache" | "permanent" | "report";
  report_id?: string;
  filename?: string;
}

export interface RenderC4Result {
  success: boolean;
  image_id: string;
  path: string;
  format: string;
  level: string;
  entities_count: number;
  relationships_count: number;
  mermaid_code: string;
}

/**
 * Neo4j 查询客户端（可选）
 */
let neo4jDriver: unknown = null;

/**
 * 初始化 Neo4j 连接
 */
async function initNeo4j(): Promise<boolean> {
  const neo4jUri = process.env.NEO4J_URI;
  const neo4jUser = process.env.NEO4J_USER;
  const neo4jPassword = process.env.NEO4J_PASSWORD;

  if (!neo4jUri || !neo4jUser || !neo4jPassword) {
    console.warn("⚠️ Neo4j not configured. C4 diagram will use mock data.");
    return false;
  }

  try {
    // 动态导入 neo4j-driver
    const neo4j = await import("neo4j-driver");
    neo4jDriver = neo4j.default.driver(
      neo4jUri,
      neo4j.default.auth.basic(neo4jUser, neo4jPassword)
    );
    return true;
  } catch (error) {
    console.warn("⚠️ Failed to connect to Neo4j:", (error as Error).message);
    return false;
  }
}

/**
 * 从 Neo4j 查询 C4 实体
 */
async function queryEntitiesFromNeo4j(
  level: "context" | "container" | "component",
  entityId?: string
): Promise<{ entities: C4Entity[]; relationships: C4Relationship[] }> {
  if (!neo4jDriver) {
    const connected = await initNeo4j();
    if (!connected) {
      // 返回模拟数据用于测试
      return getMockData(level, entityId);
    }
  }

  const driver = neo4jDriver as {
    session: () => {
      run: (query: string, params?: Record<string, unknown>) => Promise<{
        records: Array<{
          get: (key: string) => unknown;
        }>;
      }>;
      close: () => Promise<void>;
    };
  };

  const session = driver.session();

  try {
    let query: string;
    const params: Record<string, unknown> = {};

    switch (level) {
      case "context":
        // 查询系统和外部系统
        query = `
          MATCH (s:System)
          OPTIONAL MATCH (s)-[r:DEPENDS_ON|USES|CALLS]->(t)
          RETURN s, r, t
        `;
        break;

      case "container":
        // 查询容器
        query = entityId
          ? `
            MATCH (c:Container {id: $entityId})
            OPTIONAL MATCH (c)-[r:DEPENDS_ON|USES|CALLS]->(t)
            OPTIONAL MATCH (p)-[r2:DEPENDS_ON|USES|CALLS]->(c)
            RETURN c, r, t, r2, p
          `
          : `
            MATCH (c:Container)
            OPTIONAL MATCH (c)-[r:DEPENDS_ON|USES|CALLS]->(t)
            RETURN c, r, t
          `;
        if (entityId) params.entityId = entityId;
        break;

      case "component":
        // 查询组件
        query = entityId
          ? `
            MATCH (comp:Component)-[:BELONGS_TO]->(c:Container {id: $entityId})
            OPTIONAL MATCH (comp)-[r:DEPENDS_ON|USES|CALLS]->(t)
            RETURN comp, r, t, c
          `
          : `
            MATCH (comp:Component)
            OPTIONAL MATCH (comp)-[r:DEPENDS_ON|USES|CALLS]->(t)
            RETURN comp, r, t
          `;
        if (entityId) params.entityId = entityId;
        break;
    }

    const result = await session.run(query, params);

    const entitiesMap = new Map<string, C4Entity>();
    const relationshipsSet = new Set<string>();
    const relationships: C4Relationship[] = [];

    for (const record of result.records) {
      // 提取实体
      const entity = record.get("s") || record.get("c") || record.get("comp");
      if (entity && typeof entity === "object" && "properties" in entity) {
        const props = entity.properties as Record<string, string>;
        const entityObj: C4Entity = {
          id: props.id,
          name: props.name || props.id,
          description: props.description || "",
          type: getEntityType(level, props),
        };
        entitiesMap.set(entityObj.id, entityObj);
      }

      // 提取目标实体
      const target = record.get("t");
      if (target && typeof target === "object" && "properties" in target) {
        const props = target.properties as Record<string, string>;
        const targetObj: C4Entity = {
          id: props.id,
          name: props.name || props.id,
          description: props.description || "",
          type: props.external ? `${level}_ext` : level,
        };
        entitiesMap.set(targetObj.id, targetObj);
      }

      // 提取关系
      const rel = record.get("r");
      if (rel && typeof rel === "object" && "type" in rel) {
        const relObj = rel as {
          type: string;
          start: { properties: Record<string, string> };
          end: { properties: Record<string, string> };
        };
        const relKey = `${relObj.start.properties?.id}->${relObj.end.properties?.id}`;
        if (!relationshipsSet.has(relKey)) {
          relationshipsSet.add(relKey);
          relationships.push({
            from: relObj.start.properties?.id || "",
            to: relObj.end.properties?.id || "",
            label: relObj.type.toLowerCase().replace("_", " "),
          });
        }
      }
    }

    return {
      entities: Array.from(entitiesMap.values()),
      relationships,
    };
  } finally {
    await session.close();
  }
}

function getEntityType(
  level: "context" | "container" | "component",
  props: Record<string, string>
): string {
  if (props.external === "true" || props.external === true.toString()) {
    return `${level === "context" ? "system" : level}_ext`;
  }
  if (props.type === "person") return "person";
  return level === "context" ? "system" : level;
}

/**
 * 获取模拟数据（用于测试或 Neo4j 不可用时）
 */
function getMockData(
  level: "context" | "container" | "component",
  entityId?: string
): { entities: C4Entity[]; relationships: C4Relationship[] } {
  if (level === "context") {
    return {
      entities: [
        { id: "user", name: "用户", description: "使用 C4A 的架构师", type: "person" },
        { id: "c4a", name: "C4A System", description: "架构知识管理平台", type: "system" },
        { id: "gemini", name: "Gemini API", description: "Google AI 图片生成服务", type: "system_ext" },
      ],
      relationships: [
        { from: "user", to: "c4a", label: "uses" },
        { from: "c4a", to: "gemini", label: "calls" },
      ],
    };
  }

  if (level === "container") {
    return {
      entities: [
        { id: "mcp-dsl", name: "MCP DSL", description: "DSL 解析验证服务", type: "container" },
        { id: "mcp-code", name: "MCP Code", description: "代码分析服务", type: "container" },
        { id: "mcp-data", name: "MCP Data", description: "数据服务", type: "container" },
        { id: "mcp-visual", name: "MCP Visual", description: "可视化服务", type: "container" },
        { id: "mongodb", name: "MongoDB", description: "文档存储", type: "container_ext" },
        { id: "neo4j", name: "Neo4j", description: "图数据库", type: "container_ext" },
      ],
      relationships: [
        { from: "mcp-data", to: "mongodb", label: "stores data" },
        { from: "mcp-data", to: "neo4j", label: "stores graph" },
        { from: "mcp-visual", to: "neo4j", label: "queries" },
      ],
    };
  }

  // component level
  return {
    entities: [
      { id: "gemini-renderer", name: "Gemini Renderer", description: "AI 图片生成", type: "component" },
      { id: "mermaid-renderer", name: "Mermaid Renderer", description: "图表渲染", type: "component" },
      { id: "template-manager", name: "Template Manager", description: "模板管理", type: "component" },
      { id: "storage-manager", name: "Storage Manager", description: "存储管理", type: "component" },
    ],
    relationships: [
      { from: "gemini-renderer", to: "storage-manager", label: "saves to" },
      { from: "mermaid-renderer", to: "storage-manager", label: "saves to" },
      { from: "gemini-renderer", to: "template-manager", label: "uses" },
    ],
  };
}

/**
 * 渲染 C4 架构图
 */
export async function renderC4Handler(input: RenderC4Input): Promise<RenderC4Result> {
  // 查询实体和关系
  const { entities, relationships } = await queryEntitiesFromNeo4j(
    input.level,
    input.entity_id
  );

  if (entities.length === 0) {
    throw new Error(`No entities found for level: ${input.level}`);
  }

  // 生成 Mermaid C4 代码
  const mermaidCode = generateC4Diagram(input.level, entities, relationships);

  // 渲染为图片
  const renderResult = await renderMermaid({
    code: mermaidCode,
    type: "c4",
    output_format: input.output_format,
    theme: input.theme || "default",
  });

  // 保存图片
  const saveResult = await saveImage(
    renderResult.format === "svg"
      ? Buffer.from(renderResult.content, "utf-8")
      : Buffer.from(renderResult.content, "base64"),
    renderResult.format.toUpperCase(),
    input.storage_mode || "cache",
    {
      reportId: input.report_id,
      filename: input.filename,
      metadata: {
        level: input.level,
        entity_id: input.entity_id,
        entities_count: entities.length,
        relationships_count: relationships.length,
      },
    }
  );

  return {
    success: true,
    image_id: saveResult.image_id,
    path: saveResult.path,
    format: renderResult.format,
    level: input.level,
    entities_count: entities.length,
    relationships_count: relationships.length,
    mermaid_code: mermaidCode,
  };
}
