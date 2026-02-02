import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import {
  getAdapter,
  resetAdapter,
  resetWriteQueue,
  SQLiteStore,
  type StorageAdapter,
} from "@c4a/storage";
import {
  storeDeleteHandler,
  storeFeatLifecycleHandler,
  storeListHandler,
  storeReadHandler,
  storeSaveHandler,
  storeSyncHandler,
} from "../tools/index.js";

const ORIGINAL_CWD = process.cwd();
const TMP_ROOT = join(ORIGINAL_CWD, ".tmp", `mcp-store-tests-${Date.now()}`);
const DB_PATH = join(TMP_ROOT, "store.db");
const CONTEXT_DIR = join(TMP_ROOT, ".context");
const PROJECT_ID = "mcp-store-project";

let adapter: StorageAdapter;

function buildSystemDsl(id: string, name: string, description: string) {
  return {
    schema: "c4a/v1",
    type: "software-system",
    system: {
      id,
      name,
      description,
      scope: "project",
    },
  };
}

function buildContainerDsl(
  id: string,
  systemId: string,
  name: string,
  description: string,
  relationships?: Array<{ to: string; description?: string }>
) {
  return {
    schema: "c4a/v1",
    type: "container",
    container: {
      id,
      name,
      description,
      scope: "project",
      system_id: systemId,
    },
    relationships,
  };
}

function writeLocalConfig(): void {
  const config = [
    "mode: local",
    "local:",
    `  dbPath: ${DB_PATH}`,
    `  defaultProject: ${PROJECT_ID}`,
    "  enableVectorSearch: false",
    "feat:",
    "  concurrent_warning: true",
    "  auto_notify: false",
    "",
  ].join("\n");
  mkdirSync(CONTEXT_DIR, { recursive: true });
  writeFileSync(join(CONTEXT_DIR, ".c4a.yaml"), config, "utf-8");
}

function resetDatabase(): void {
  const store = SQLiteStore.getInstance({ dbPath: DB_PATH });
  const db = store.getDatabase();
  db.exec(`
    DELETE FROM relations;
    DELETE FROM metadata;
    DELETE FROM entities;
    DELETE FROM entity_history;
    DELETE FROM feats;
    DELETE FROM feat_history;
    DELETE FROM graph_cache;
    DELETE FROM workflow_states;
    DELETE FROM compensation_logs;
    DELETE FROM configs;
  `);
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

beforeAll(async () => {
  ensureDir(TMP_ROOT);
  writeLocalConfig();
  process.chdir(TMP_ROOT);
  resetAdapter();
  resetWriteQueue();
  adapter = await getAdapter();
});

beforeEach(async () => {
  resetAdapter();
  resetWriteQueue();
  rmSync(DB_PATH, { force: true });
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
  resetDatabase();
  adapter = await getAdapter();
});

afterAll(() => {
  resetAdapter();
  resetWriteQueue();
  process.chdir(ORIGINAL_CWD);
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("MCP Store Integration", () => {
  describe("c4a_store_save", () => {
    it("should save entity with valid DSL", async () => {
      const entityId = makeId("sys");
      const result = await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Demo System", "Demo"),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe(entityId);

      const read = await storeReadHandler({ id: entityId, format: "object" });
      expect(read && "entity" in read).toBe(true);
      if (read && "entity" in read) {
        expect(read.entity?.id).toBe(entityId);
      }
    });

    it("should reject invalid DSL", async () => {
      await expect(
        storeSaveHandler({
          type: "system",
          content: "invalid: [",
          format: "yaml",
          source_project: PROJECT_ID,
          proposal_id: null,
        })
      ).rejects.toThrow();
    });

    it("should handle concurrent modification warning", async () => {
      const entityId = makeId("sys");
      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Base System", "Main"),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Feat B", "Feat B"),
        source_project: PROJECT_ID,
        proposal_id: "feat-b",
      });

      const result = await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Feat A", "Feat A"),
        source_project: PROJECT_ID,
        proposal_id: "feat-a",
      });

      expect(result.warnings?.some((warning) => warning.code === "CONCURRENT_MODIFICATION")).toBe(
        true
      );
    });
  });

  describe("c4a_store_read", () => {
    it("should read entity by id", async () => {
      const entityId = makeId("sys");
      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Read System", "Read"),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      const result = await storeReadHandler({ id: entityId, format: "object" });
      expect(result && "entity" in result).toBe(true);
      if (result && "entity" in result) {
        expect(result.entity?.id).toBe(entityId);
      }
    });

    it("should return reference integrity warnings", async () => {
      const systemId = makeId("sys");
      const targetId = makeId("target");
      const consumerId = makeId("consumer");

      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(systemId, "System", "System"),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      await storeSaveHandler({
        type: "container",
        data: buildContainerDsl(targetId, systemId, "Target", "Target"),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      await storeSaveHandler({
        type: "container",
        data: buildContainerDsl(consumerId, systemId, "Consumer", "Consumer", [
          { to: targetId, description: "depends" },
        ]),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      const result = await storeSaveHandler({
        type: "container",
        data: {
          ...buildContainerDsl(targetId, systemId, "Target", "Target"),
          status: "deprecated",
        },
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      expect(result.warnings?.some((warning) => warning.code === "DANGLING_REFERENCE")).toBe(
        true
      );
    });
  });

  describe("c4a_store_list", () => {
    it("should list entities with filters", async () => {
      const sysId = makeId("sys");
      const containerId = makeId("container");

      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(sysId, "List System", "List"),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      await storeSaveHandler({
        type: "container",
        data: buildContainerDsl(containerId, sysId, "List Container", "List"),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      const result = await storeListHandler({
        type: "system",
        project_id: PROJECT_ID,
        limit: 10,
        offset: 0,
      });

      if ("items" in result) {
        expect(result.items.some((item) => item.id === sysId)).toBe(true);
        expect(result.items.every((item) => item.type === "system")).toBe(true);
      }
    });

    it("should support pagination", async () => {
      const sysIds = [makeId("sys"), makeId("sys"), makeId("sys")];
      for (const id of sysIds) {
        await storeSaveHandler({
          type: "system",
          data: buildSystemDsl(id, "Paged System", "Paged"),
          source_project: PROJECT_ID,
          proposal_id: null,
        });
      }

      const result = await storeListHandler({
        type: "system",
        project_id: PROJECT_ID,
        limit: 1,
        offset: 0,
      });

      if ("pagination" in result) {
        expect(result.pagination?.has_more).toBe(true);
      }
    });
  });

  describe("c4a_store_delete", () => {
    it("should soft delete entity", async () => {
      const entityId = makeId("sys");

      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Main", "Main"),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Feat", "Feat"),
        source_project: PROJECT_ID,
        proposal_id: "feat-soft",
      });

      await storeDeleteHandler({ id: entityId, proposal_id: "feat-soft", force: false });

      const result = await storeReadHandler({
        id: entityId,
        format: "object",
        proposal_id: "feat-soft",
      });

      expect(result && "entity" in result).toBe(true);
      if (result && "entity" in result) {
        expect(result.entity?.metadata.status).toBe("archived");
      }
    });

    it("should check references before delete", async () => {
      const systemId = makeId("sys");
      const targetId = makeId("target");
      const consumerId = makeId("consumer");

      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(systemId, "System", "System"),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      await storeSaveHandler({
        type: "container",
        data: buildContainerDsl(targetId, systemId, "Target", "Target"),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      await storeSaveHandler({
        type: "container",
        data: buildContainerDsl(consumerId, systemId, "Consumer", "Consumer", [
          { to: targetId, description: "depends" },
        ]),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      const result = await adapter.delete({ id: targetId, force: false });
      expect(result.warnings?.some((warning) => warning.code === "DANGLING_REFERENCE")).toBe(
        true
      );
    });
  });

  describe("c4a_store_feat_lifecycle", () => {
    it("should create feat", async () => {
      const featId = `feat-${Date.now()}`;
      const result = await storeFeatLifecycleHandler({
        action: "create",
        feat_id: featId,
        metadata: {
          title: "feat",
          description: "desc",
          created_by: "tester",
        },
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("draft");
    });

    it("should transition draft → approved → published", async () => {
      const featId = `feat-${Date.now()}`;
      await storeFeatLifecycleHandler({
        action: "create",
        feat_id: featId,
        metadata: {
          title: "feat",
          description: "desc",
          created_by: "tester",
        },
      });

      const approved = await storeFeatLifecycleHandler({
        action: "transition",
        feat_id: featId,
        to_status: "approved",
      });
      expect(approved.success).toBe(true);
      expect(approved.to_status).toBe("approved");

      const published = await storeFeatLifecycleHandler({
        action: "transition",
        feat_id: featId,
        to_status: "published",
      });
      expect(published.success).toBe(true);
      expect(published.to_status).toBe("published");
    });

    it("should handle merge conflicts", async () => {
      const featId = `feat-${Date.now()}`;
      const entityId = makeId("conflict");

      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Main", "Main"),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      await storeFeatLifecycleHandler({
        action: "create",
        feat_id: featId,
        metadata: {
          title: "feat",
          description: "desc",
          created_by: "tester",
        },
      });

      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Feat", "Feat"),
        source_project: PROJECT_ID,
        proposal_id: featId,
      });

      await storeFeatLifecycleHandler({
        action: "transition",
        feat_id: featId,
        to_status: "approved",
      });

      const published = await storeFeatLifecycleHandler({
        action: "transition",
        feat_id: featId,
        to_status: "published",
      });

      expect(published.success).toBe(false);
      expect(published.error).toBe("merge_conflict");
      expect(Array.isArray(published.conflicts)).toBe(true);
    });
  });

  describe("c4a_store_sync", () => {
    it("should sync single file", async () => {
      const syncRoot = join(TMP_ROOT, "sync-single");
      const filePath = join(syncRoot, "systems", `${makeId("sys")}.yaml`);
      ensureDir(dirname(filePath));
      writeFileSync(
        filePath,
        [
          `id: ${makeId("sync")}`,
          "type: system",
          "name: Sync System",
          "description: Sync",
        ].join("\n"),
        "utf-8"
      );

      const result = await storeSyncHandler({
        direction: "import",
        path: syncRoot,
        mode: "incremental",
        status_filter: "all",
      });

      expect(result.success).toBe(true);
      expect(result.stats.created).toBe(1);
    });

    it("should sync directory", async () => {
      const syncRoot = join(TMP_ROOT, "sync-dir");
      const entityId = makeId("sys");

      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Sync System", "Sync"),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      const result = await storeSyncHandler({
        direction: "export",
        path: syncRoot,
        mode: "incremental",
        format: "yaml",
        status_filter: "all",
      });

      expect(result.success).toBe(true);
      const exportedPath = join(syncRoot, "systems", `${entityId}.yaml`);
      expect(existsSync(exportedPath)).toBe(true);
    });

    it("should detect conflicts", async () => {
      const syncRoot = join(TMP_ROOT, "sync-conflict");
      const entityId = makeId("sys");

      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Sync System", "Sync"),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      await storeSyncHandler({
        direction: "export",
        path: syncRoot,
        mode: "incremental",
        format: "yaml",
        status_filter: "all",
      });

      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Sync System Updated", "Sync"),
        source_project: PROJECT_ID,
        proposal_id: null,
      });

      const result = await storeSyncHandler({
        direction: "export",
        path: syncRoot,
        mode: "incremental",
        format: "yaml",
        status_filter: "all",
        conflict_policy: "warn",
      });

      expect(result.stats.conflicted).toBe(1);
      expect(result.details?.some((detail) => detail.action === "conflict")).toBe(true);
    });
  });
});
