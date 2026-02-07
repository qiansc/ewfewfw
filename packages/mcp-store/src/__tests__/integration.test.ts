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
  storeAddVersionHandler,
  storeDeleteHandler,
  storeFeatChecklistHandler,
  storeFeatLifecycleHandler,
  storeListHandler,
  storePublishVersionHandler,
  storeReadHandler,
  storeRemoveVersionHandler,
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

function writeServerConfig(): void {
  const config = [
    "mode: server",
    "server:",
    "  url: http://localhost:8055",
    "  embedding:",
    "    provider: pseudo",
    "    vectorDim: 16",
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
    DELETE FROM feat_history;
    DELETE FROM graph_cache;
    DELETE FROM workflow_states;
    DELETE FROM compensation_logs;
    DELETE FROM configs;
    DELETE FROM entity_versions;
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
        root_id: PROJECT_ID,
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe(entityId);
      expect(result.entity.uuid).toBeTruthy();
      expect(result.entity.versions?.includes("0.0.0")).toBe(true);

      const read = await storeReadHandler({ root_id: PROJECT_ID, id: entityId });
      expect(read && "entity" in read).toBe(true);
      if (read && "entity" in read) {
        expect(read.entity?.id).toBe(entityId);
        expect(read.entity?.root_id).toBe(PROJECT_ID);
      }
    });

    it("should update entity when uuid provided", async () => {
      const entityId = makeId("sys");
      const created = await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Base System", "Base"),
        root_id: PROJECT_ID,
      });

      const updated = await storeSaveHandler({
        type: "system",
        uuid: created.entity.uuid,
        data: buildSystemDsl(entityId, "Updated System", "Updated"),
        root_id: PROJECT_ID,
      });

      expect(updated.entity.uuid).toBe(created.entity.uuid);
      expect(updated.entity.data?.system?.name).toBe("Updated System");
    });

    it("should reject invalid DSL", async () => {
      await expect(
        storeSaveHandler({
          type: "system",
          content: "invalid: [",
          format: "yaml",
          root_id: PROJECT_ID,
        })
      ).rejects.toThrow();
    });
  });

  describe("c4a_store_feat_*", () => {
    it("should return feat uuid, transition status, and link checklist to feat", async () => {
      const featId = makeId("feat");

      const created = await storeFeatLifecycleHandler({
        action: "create",
        feat_id: featId,
        sync_checklist: false,
        force_publish: false,
        metadata: {
          title: "Feat",
          description: "Demo",
          created_by: "tester",
        },
      });
      expect(created.success).toBe(true);
      expect(created.feat_uuid).toBeTruthy();

      const approved = await storeFeatLifecycleHandler({
        action: "transition",
        feat_id: featId,
        to_status: "approved",
        sync_checklist: false,
        force_publish: false,
      });
      expect(approved.success).toBe(true);
      expect(approved.from_status).toBe("draft");
      expect(approved.to_status).toBe("approved");

      const published = await storeFeatLifecycleHandler({
        action: "transition",
        feat_id: featId,
        to_status: "published",
        sync_checklist: false,
        force_publish: false,
      });
      expect(published.success).toBe(true);
      expect(published.from_status).toBe("approved");
      expect(published.to_status).toBe("published");

      const checklist = await storeFeatChecklistHandler({
        action: "generate",
        feat_id: featId,
        source: "technical_spec",
      });
      expect(checklist.success).toBe(true);

      const featUuid = created.feat_uuid ?? "";
      const checklistEntities = await storeListHandler({
        type: "checklist",
        root_id: "",
        requirement_id: featUuid,
        limit: 10,
      });
      if ("items" in checklistEntities) {
        expect(checklistEntities.items.length).toBe(1);
      } else {
        throw new Error("Unexpected list result for checklist entities");
      }
    });
  });

  describe("c4a_store_read", () => {
    it("should read entity by uuid", async () => {
      const entityId = makeId("sys");
      const saved = await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Read System", "Read"),
        root_id: PROJECT_ID,
      });

      const result = await storeReadHandler({ uuid: saved.entity.uuid });
      expect(result && "entity" in result).toBe(true);
      if (result && "entity" in result) {
        expect(result.entity?.id).toBe(entityId);
      }
    });

    it("should return version chain when include_versions is true", async () => {
      const entityId = makeId("sys");
      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Chain System", "Chain"),
        root_id: PROJECT_ID,
      });

      const result = await storeReadHandler({
        root_id: PROJECT_ID,
        id: entityId,
        include_versions: true,
      });
      expect(Array.isArray(result)).toBe(true);
      if (Array.isArray(result)) {
        expect(result.length).toBeGreaterThan(0);
      }
    });
  });

  describe("c4a_store_list", () => {
    it("should list entities with filters", async () => {
      const sysId = makeId("sys");
      const containerId = makeId("container");

      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(sysId, "List System", "List"),
        root_id: PROJECT_ID,
      });

      await storeSaveHandler({
        type: "container",
        data: buildContainerDsl(containerId, sysId, "List Container", "List"),
        root_id: PROJECT_ID,
      });

      const result = await storeListHandler({
        type: "system",
        root_id: PROJECT_ID,
        limit: 10,
        offset: 0,
        count_only: false,
      });

      if ("items" in result) {
        expect(result.items.some((item) => item.id === sysId)).toBe(true);
        expect(result.items.every((item) => item.type === "system")).toBe(true);
      }
    });
  });

  describe("c4a_store_delete", () => {
    it("should delete entity by uuid", async () => {
      const entityId = makeId("sys");
      const saved = await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Main", "Main"),
        root_id: PROJECT_ID,
      });

      await storeDeleteHandler({ uuid: saved.entity.uuid, cascade: false });

      const read = await storeReadHandler({ uuid: saved.entity.uuid });
      expect(read && "entity" in read).toBe(false);
    });

    it("should cascade delete entities with same root_id/id", async () => {
      const entityId = makeId("sys");
      const first = await adapter.save({
        uuid: undefined,
        id: entityId,
        root_id: PROJECT_ID,
        type: "system",
        data: buildSystemDsl(entityId, "Cascade", "Cascade"),
      });
      const second = await adapter.save({
        uuid: undefined,
        id: entityId,
        root_id: PROJECT_ID,
        type: "system",
        data: buildSystemDsl(entityId, "Cascade 2", "Cascade"),
      });

      await storeDeleteHandler({ uuid: first.uuid!, cascade: true });
      const remaining = await adapter.list({ root_id: PROJECT_ID, id: entityId });
      expect(remaining.length).toBe(0);
      expect(second.uuid).toBeTruthy();
    });
  });

  describe("c4a_store_version", () => {
    it("should add and remove versions", async () => {
      const entityId = makeId("sys");
      const saved = await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Version System", "Version"),
        root_id: PROJECT_ID,
      });

      const added = await storeAddVersionHandler({
        uuid: saved.entity.uuid,
        version: "1.0.0",
      });
      expect(added.versions.includes("1.0.0")).toBe(true);

      const removed = await storeRemoveVersionHandler({
        uuid: saved.entity.uuid,
        version: "1.0.0",
      });
      expect(removed.versions.includes("1.0.0")).toBe(false);
    });

    it("should reject adding 0.0.0 manually", async () => {
      const entityId = makeId("sys");
      const saved = await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Latest System", "Latest"),
        root_id: PROJECT_ID,
      });

      await expect(
        storeAddVersionHandler({
          uuid: saved.entity.uuid,
          version: "0.0.0",
        })
      ).rejects.toMatchObject({ code: "C4A-VERSION-005" });
    });

    it("should publish version for latest entities", async () => {
      const sysA = makeId("sys");
      const sysB = makeId("sys");
      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(sysA, "Publish A", "Publish"),
        root_id: PROJECT_ID,
      });
      await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(sysB, "Publish B", "Publish"),
        root_id: PROJECT_ID,
      });

      const result = await storePublishVersionHandler({
        root_id: PROJECT_ID,
        version: "2.0.0",
      });
      expect(result.success).toBe(true);
      expect(result.affected_entities).toBeGreaterThan(0);

      const versioned = await adapter.list({ root_id: PROJECT_ID, version: "2.0.0" });
      expect(versioned.length).toBeGreaterThan(0);
    });

    it("should read and list entities by version", async () => {
      const entityId = makeId("sys");
      const saved = await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Versioned System", "Versioned"),
        root_id: PROJECT_ID,
      });

      await storeAddVersionHandler({
        uuid: saved.entity.uuid,
        version: "1.0.0",
      });

      const listResult = await storeListHandler({
        root_id: PROJECT_ID,
        type: "system",
        version: "1.0.0",
        count_only: false,
      });

      if ("items" in listResult) {
        expect(listResult.items.some((item) => item.id === entityId)).toBe(true);
      }

      const readResult = await storeReadHandler({
        root_id: PROJECT_ID,
        id: entityId,
        version: "1.0.0",
      });
      if (readResult && "entity" in readResult) {
        expect(readResult.entity?.versions?.includes("1.0.0")).toBe(true);
      }
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
        format: "yaml",
        status_filter: "all",
        conflict_policy: "skip",
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
        root_id: PROJECT_ID,
      });

      const result = await storeSyncHandler({
        direction: "export",
        path: syncRoot,
        mode: "incremental",
        format: "yaml",
        status_filter: "all",
        conflict_policy: "skip",
      });

      expect(result.success).toBe(true);
      const exportedPath = join(syncRoot, "systems", `${entityId}.yaml`);
      expect(existsSync(exportedPath)).toBe(true);
    });
  });

  describe("Server mode E2E", () => {
    beforeAll(async () => {
      writeServerConfig();
      resetAdapter();
      resetWriteQueue();
      adapter = await getAdapter();
    });

    it("should handle save/read/list/version lifecycle in server mode", async () => {
      const rootId = "@acme/server";
      const entityId = makeId("server");

      const created = await storeSaveHandler({
        type: "system",
        data: buildSystemDsl(entityId, "Server System", "Server"),
        root_id: rootId,
      });
      expect(created.success).toBe(true);
      expect(created.entity.root_id).toBe(rootId);

      const read = await storeReadHandler({ root_id: rootId, id: entityId });
      expect(read && "entity" in read).toBe(true);
      if (read && "entity" in read) {
        expect(read.entity?.uuid).toBe(created.entity.uuid);
      }

      const listed = await storeListHandler({ root_id: rootId, limit: 10 });
      if (!("items" in listed)) {
        throw new Error("Expected list result with items");
      }
      expect(Array.isArray(listed.items)).toBe(true);
      expect(listed.items.some((item) => item.id === entityId)).toBe(true);

      const addVersion = await storeAddVersionHandler({
        uuid: created.entity.uuid,
        version: "1.0.0",
      });
      expect(addVersion.versions.includes("1.0.0")).toBe(true);

      const publish = await storePublishVersionHandler({
        root_id: rootId,
        version: "1.1.0",
      });
      expect(publish.success).toBe(true);

      const removeVersion = await storeRemoveVersionHandler({
        uuid: created.entity.uuid,
        version: "1.0.0",
      });
      expect(removeVersion.versions.includes("1.0.0")).toBe(false);
    });
  });
});
