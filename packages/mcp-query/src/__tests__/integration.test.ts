import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  LiteAdapter,
  SQLiteStore,
  type LiteAdapterConfig,
  ServerAdapter,
} from "@c4a/storage";
import { queryDepsHandler } from "../tools/deps.js";
import { queryImpactHandler } from "../tools/impact.js";
import { querySearchHandler } from "../tools/search.js";

const TMP_ROOT = join(process.cwd(), ".tmp", "mcp-query-tests");
const DB_PATH = join(TMP_ROOT, `mcp-query-${Date.now()}.db`);
const ROOT_ID = "mcp-query-root";

let adapter: LiteAdapter;
let serverAdapter: ServerAdapter | null = null;

function resetSQLiteStore(): void {
  const storeClass = SQLiteStore as unknown as { instance: SQLiteStore | null };
  storeClass.instance = null;
}

async function createAdapter(): Promise<LiteAdapter> {
  const config: LiteAdapterConfig = {
    dbPath: DB_PATH,
    defaultProject: ROOT_ID,
    enableVectorSearch: false,
    repoId: null,
    feat: {
      concurrent_warning: false,
      auto_notify: false,
    },
  };
  const instance = new LiteAdapter(config);
  await instance.initialize();
  return instance;
}

async function saveEntity(params: {
  type: "system" | "container" | "component";
  id: string;
  name: string;
  description: string;
  relationships?: Array<{ to: string; description?: string }>;
  versions?: string[];
}): Promise<{ uuid?: string }> {
  return adapter.save({
    type: params.type,
    id: params.id,
    root_id: ROOT_ID,
    versions: params.versions,
    data: {
      id: params.id,
      name: params.name,
      description: params.description,
      scope: "project",
      relationships: params.relationships,
    },
  });
}

function buildId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function buildToken(prefix: string): string {
  return `${prefix}${Date.now()}`;
}

beforeAll(async () => {
  mkdirSync(TMP_ROOT, { recursive: true });
  adapter = await createAdapter();
});

afterAll(async () => {
  await adapter.close();
  resetSQLiteStore();
  rmSync(DB_PATH, { force: true });
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("MCP Query Integration", () => {
  describe("c4a_query_search", () => {
    it("should perform semantic search", async () => {
      const token = buildToken("search");
      const entityId = buildId("system");

      await saveEntity({
        type: "system",
        id: entityId,
        name: `Search ${token}`,
        description: `Query ${token}`,
      });

      const result = await querySearchHandler(
        {
          query: token,
          scope: "all",
          limit: 5,
          offset: 0,
        },
        { adapter }
      );

      expect(result.success).toBe(true);
      expect(result.items.some((item) => item.id === entityId)).toBe(true);
      const matched = result.items.find((item) => item.id === entityId);
      expect((matched?.summary ?? "").toLowerCase()).toContain(token.toLowerCase());
    });

    it("should filter by entity type", async () => {
      const token = buildToken("filter");
      const systemId = buildId("system");
      const containerId = buildId("container");

      await saveEntity({
        type: "system",
        id: systemId,
        name: `Filter ${token}`,
        description: `Only system ${token}`,
      });

      await saveEntity({
        type: "container",
        id: containerId,
        name: `Filter ${token}`,
        description: `Container ${token}`,
      });

      const result = await querySearchHandler(
        {
          query: token,
          scope: "system",
          limit: 10,
          offset: 0,
        },
        { adapter }
      );

      expect(result.success).toBe(true);
      expect(result.items.some((item) => item.id === systemId)).toBe(true);
      expect(result.items.every((item) => item.type === "system")).toBe(true);
      expect(result.items.some((item) => item.id === containerId)).toBe(false);
    });

    it("should accept type_filter as alias", async () => {
      const token = buildToken("alias");
      const systemId = buildId("system");
      const containerId = buildId("container");

      await saveEntity({
        type: "system",
        id: systemId,
        name: `Alias ${token}`,
        description: `Only system ${token}`,
      });

      await saveEntity({
        type: "container",
        id: containerId,
        name: `Alias ${token}`,
        description: `Container ${token}`,
      });

      const result = await querySearchHandler(
        {
          query: token,
          type_filter: "system",
          limit: 10,
          offset: 0,
        },
        { adapter }
      );

      expect(result.success).toBe(true);
      expect(result.items.some((item) => item.id === systemId)).toBe(true);
      expect(result.items.every((item) => item.type === "system")).toBe(true);
      expect(result.items.some((item) => item.id === containerId)).toBe(false);
    });

    it("should filter by versions", async () => {
      const token = buildToken("versions");
      const mainId = buildId("system");
      const releaseId = buildId("system");

      await saveEntity({
        type: "system",
        id: mainId,
        name: `Main ${token}`,
        description: `Main ${token}`,
      });

      const release = await adapter.save({
        type: "system",
        id: releaseId,
        root_id: ROOT_ID,
        data: {
          id: releaseId,
          name: `Release ${token}`,
          description: `Release ${token}`,
          scope: "project",
        },
      });
      await adapter.addVersion(release.uuid!, "1.0.0");

      const result = await querySearchHandler(
        {
          query: "Release",
          versions: ["1.0.0"],
          limit: 10,
          offset: 0,
        },
        { adapter }
      );

      expect(result.success).toBe(true);
      expect(result.items.some((item) => item.id === releaseId)).toBe(true);
      expect(result.items.some((item) => item.id === mainId)).toBe(false);
    });

  });

  describe("c4a_query_deps", () => {
    it("should query dependencies", async () => {
      const rootId = buildId("root");
      const depId = buildId("dep");

      await saveEntity({
        type: "container",
        id: depId,
        name: `Dep ${depId}`,
        description: `Dep ${depId}`,
      });

      await saveEntity({
        type: "container",
        id: rootId,
        name: `Root ${rootId}`,
        description: `Root ${rootId}`,
        relationships: [{ to: depId, description: "depends" }],
      });

      const result = await queryDepsHandler(
        {
          id: rootId,
          root_id: ROOT_ID,
          direction: "downstream",
          depth: 1,
        },
        { adapter }
      );

      expect(result.success).toBe(true);
      expect(result.items.some((item) => item.id === depId)).toBe(true);
    });

    it("should support depth limit", async () => {
      const rootId = buildId("root");
      const midId = buildId("mid");
      const leafId = buildId("leaf");

      await saveEntity({
        type: "container",
        id: leafId,
        name: `Leaf ${leafId}`,
        description: `Leaf ${leafId}`,
      });

      await saveEntity({
        type: "container",
        id: midId,
        name: `Mid ${midId}`,
        description: `Mid ${midId}`,
        relationships: [{ to: leafId, description: "depends" }],
      });

      await saveEntity({
        type: "container",
        id: rootId,
        name: `Root ${rootId}`,
        description: `Root ${rootId}`,
        relationships: [{ to: midId, description: "depends" }],
      });

      const result = await queryDepsHandler(
        {
          id: rootId,
          root_id: ROOT_ID,
          direction: "downstream",
          depth: 1,
        },
        { adapter }
      );

      expect(result.success).toBe(true);
      expect(result.items.some((item) => item.id === midId)).toBe(true);
      expect(result.items.some((item) => item.id === leafId)).toBe(false);
    });
  });

  describe("c4a_query_impact", () => {
    it("should analyze impact", async () => {
      const rootId = buildId("impact-root");
      const directId = buildId("impact-direct");
      const indirectId = buildId("impact-indirect");

      await saveEntity({
        type: "component",
        id: indirectId,
        name: `Indirect ${indirectId}`,
        description: `Indirect ${indirectId}`,
      });

      await saveEntity({
        type: "component",
        id: directId,
        name: `Direct ${directId}`,
        description: `Direct ${directId}`,
        relationships: [{ to: indirectId, description: "calls" }],
      });

      await saveEntity({
        type: "component",
        id: rootId,
        name: `Root ${rootId}`,
        description: `Root ${rootId}`,
        relationships: [{ to: directId, description: "calls" }],
      });

      const result = await queryImpactHandler(
        {
          id: rootId,
          root_id: ROOT_ID,
          depth: 2,
          change_type: "remove",
        },
        { adapter }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const direct = result.items?.find((item) => item.id === directId);
        const indirect = result.items?.find((item) => item.id === indirectId);
        expect(direct?.impact_level).toBe("direct");
        expect(indirect?.impact_level).toBe("indirect");
        expect(direct?.reason).toBe("breaking");
      }
    });

    it("should analyze impact across versions", async () => {
      const rootId = buildId("impact-version-root");
      const directId = buildId("impact-version-direct");
      const indirectId = buildId("impact-version-indirect");

      await saveEntity({
        type: "component",
        id: indirectId,
        name: `Indirect ${indirectId}`,
        description: `Indirect ${indirectId}`,
      });

      await saveEntity({
        type: "component",
        id: directId,
        name: `Direct ${directId}`,
        description: `Direct ${directId}`,
        relationships: [{ to: indirectId, description: "calls" }],
      });

      const root = await saveEntity({
        type: "component",
        id: rootId,
        name: `Root ${rootId}`,
        description: `Root ${rootId}`,
        relationships: [{ to: directId, description: "calls" }],
      });

      if (!root.uuid) {
        throw new Error("missing root uuid");
      }
      await adapter.addVersion(root.uuid, "1.0.0");

      const result = await queryImpactHandler(
        {
          uuid: root.uuid,
          depth: 2,
          change_type: "upgrade",
        },
        { adapter }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const direct = result.items?.find((item) => item.id === directId);
        const indirect = result.items?.find((item) => item.id === indirectId);
        expect(direct?.impact_level).toBe("direct");
        expect(indirect?.impact_level).toBe("indirect");
      }
    });
  });
});

describe("MCP Query Integration (Server Mode)", () => {
  const ROOT_ID = "@acme/server-query";

  beforeAll(async () => {
    serverAdapter = new ServerAdapter({
      url: "http://localhost:8055",
      embedding: { provider: "pseudo", vectorDim: 16 },
    });
    await serverAdapter.initialize();
  });

  afterAll(async () => {
    if (serverAdapter) {
      await serverAdapter.close();
      serverAdapter = null;
    }
  });

  it("should run search/deps/impact in server mode", async () => {
    if (!serverAdapter) {
      throw new Error("Server adapter not initialized");
    }

    const systemId = buildId("server-system");
    const componentId = buildId("server-component");

    const component = await serverAdapter.save({
      type: "component",
      id: componentId,
      root_id: ROOT_ID,
      data: {
        id: componentId,
        name: "Server Component",
        description: "Server component description",
        scope: "project",
      },
    });

    const system = await serverAdapter.save({
      type: "system",
      id: systemId,
      root_id: ROOT_ID,
      data: {
        id: systemId,
        name: "Server System",
        description: "Server system description",
        scope: "project",
        relationships: [
          {
            to_uuid: component.uuid,
            to_id: componentId,
            to_root_id: ROOT_ID,
            to_type: "component",
            rel_type: "DEPENDS_ON",
          },
        ],
      },
    });

    const search = await querySearchHandler(
      { query: "Server System", scope: "all", root_id: ROOT_ID, limit: 10, offset: 0 },
      { adapter: serverAdapter }
    );
    expect(search.success).toBe(true);
    expect(search.items.some((item) => item.id === systemId)).toBe(true);

    const deps = await queryDepsHandler(
      { uuid: system.uuid, direction: "downstream", depth: 2 },
      { adapter: serverAdapter }
    );
    expect(deps.success).toBe(true);
    expect(deps.items.some((node) => node.uuid === component.uuid)).toBe(true);

    const impact = await queryImpactHandler(
      { uuid: system.uuid, depth: 2 },
      { adapter: serverAdapter }
    );
    if (impact.success === false) {
      throw new Error(`Impact query failed: ${impact.error}`);
    }
    expect(impact.items.some((node) => node.uuid === component.uuid)).toBe(true);
  });
});
