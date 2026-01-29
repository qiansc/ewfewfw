import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SQLiteStore,
  getAdapter,
  resetAdapter,
} from "@c4a/storage";
import {
  storeSaveHandler,
  storeReadHandler,
  storeListHandler,
  storeDeleteHandler,
  storeSyncHandler,
  storePlanSyncHandler,
  storeFeatLifecycleHandler,
  storeFeatMergeHandler,
  storeFeatChecklistHandler,
  storeUpdateWorkflowStepHandler,
  storeReadHistoryHandler,
  storeBackupHandler,
  storeRestoreHandler,
  storeRepairHandler,
  storeValidateHandler,
  computeHash,
  getFileHash,
  executeWriteAction,
  executeBatchWriteActions,
  parseC4AHeader,
  generateProtectedContent,
  extractBody,
  checkBeforeRender,
  safeRenderFile,
  formatCheckError,
  saveSessionState,
  loadSessionState,
  clearSessionState,
  shouldUseBatchSync,
  batchSync,
  resumeSync,
  cancelSync,
} from "../mcp/store/index.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(TEST_DIR, "../../../../");
const TMP_ROOT = join(ROOT_DIR, ".tmp", "cli-store-tests", randomUUID());
const CONTEXT_DIR = join(TMP_ROOT, ".context");
const DB_PATH = join(TMP_ROOT, "c4a.db");
const DSL_DIR = join(CONTEXT_DIR, "dsl");

const ORIGINAL_CWD = process.cwd();

function resetStoreInstance(): void {
  const storeClass = SQLiteStore as unknown as { instance: SQLiteStore | null };
  storeClass.instance?.close();
  storeClass.instance = null;
}

beforeAll(() => {
  mkdirSync(CONTEXT_DIR, { recursive: true });
  writeFileSync(
    join(CONTEXT_DIR, ".c4a.yaml"),
    [
      "mode: local",
      "project_id: alpha",
      "repo_id: repo-test",
      "feat:",
      "  concurrent_warning: true",
      "  auto_notify: false",
      "local:",
      `  dbPath: ${DB_PATH}`,
      "  defaultProject: alpha",
      "  enableVectorSearch: false",
    ].join("\n"),
    "utf-8"
  );
  mkdirSync(DSL_DIR, { recursive: true });
  process.chdir(TMP_ROOT);
});

afterAll(() => {
  resetAdapter();
  resetStoreInstance();
  process.chdir(ORIGINAL_CWD);
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("double-check utilities", () => {
  test("computeHash and executeWriteAction guard changes", async () => {
    const content = "hello";
    const hash = computeHash(content);
    expect(hash.length).toBe(64);

    const filePath = join(TMP_ROOT, "files", "sample.txt");
    const currentHash = await getFileHash(filePath);
    expect(currentHash).toBeNull();

    const firstWrite = await executeWriteAction(
      { op: "download", path: "files/sample.txt", expected_hash: null, content },
      TMP_ROOT
    );
    expect(firstWrite.success).toBe(true);

    const secondWrite = await executeWriteAction(
      { op: "download", path: "files/sample.txt", expected_hash: null, content },
      TMP_ROOT
    );
    expect(secondWrite.success).toBe(false);
    expect(secondWrite.error).toBe("FILE_ALREADY_EXISTS");

    const mismatch = await executeWriteAction(
      { op: "download", path: "files/sample.txt", expected_hash: "bad", content: "next" },
      TMP_ROOT
    );
    expect(mismatch.success).toBe(false);
    expect(mismatch.error).toBe("LOCAL_FILE_CHANGED");

    const deleteMismatch = await executeWriteAction(
      { op: "delete_local", path: "files/sample.txt", expected_hash: "bad" },
      TMP_ROOT
    );
    expect(deleteMismatch.success).toBe(false);
    expect(deleteMismatch.error).toBe("LOCAL_FILE_CHANGED");

    const deleteOk = await executeWriteAction(
      { op: "delete_local", path: "files/sample.txt", expected_hash: hash },
      TMP_ROOT
    );
    expect(deleteOk.success).toBe(true);

    const batch = await executeBatchWriteActions(
      [
        { op: "download", path: "files/a.txt", expected_hash: null, content: "a" },
        { op: "download", path: "files/a.txt", expected_hash: null, content: "b" },
      ],
      TMP_ROOT
    );
    expect(batch.results.length).toBe(2);
    expect(batch.hasConflicts).toBe(true);
  });
});

describe("file protection helpers", () => {
  test("safeRenderFile preserves C4A header rules", () => {
    const filePath = join(CONTEXT_DIR, "feat", "feat-1", "checklist.md");
    const body = "line1\nline2";
    const content = generateProtectedContent("feat-1", body);
    const header = parseC4AHeader(content);
    expect(header?.feat_id).toBe("feat-1");
    expect(header?.content_hash).toBe(computeHash(body));
    expect(extractBody(content)).toBe(body);

    const first = safeRenderFile(filePath, "feat-1", body);
    expect(first.success).toBe(true);
    expect(first.action).toBe("created");

    const check = checkBeforeRender(filePath);
    expect(check.canRender).toBe(true);

    writeFileSync(filePath, "manual change", "utf-8");
    const modified = checkBeforeRender(filePath);
    expect(modified.canRender).toBe(false);
    const error = formatCheckError(modified, filePath);
    expect(error.includes(filePath)).toBe(true);

    const forced = safeRenderFile(filePath, "feat-1", body, { force: true });
    expect(forced.success).toBe(true);
    expect(forced.action).toBe("force_overwritten");
  });
});

describe("batch sync helpers", () => {
  test("session state helpers and batch sync flow", async () => {
    const state = { session_id: "sess-1", uploaded_entities: [], last_updated: new Date().toISOString() };
    await saveSessionState(TMP_ROOT, state);
    const loaded = await loadSessionState(TMP_ROOT);
    expect(loaded?.session_id).toBe("sess-1");
    await clearSessionState(TMP_ROOT);
    const cleared = await loadSessionState(TMP_ROOT);
    expect(cleared).toBeNull();

    expect(shouldUseBatchSync(101)).toBe(true);

    const filePath = join(TMP_ROOT, "files", "entity.yaml");
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, "id: e1\ntype: system\n", "utf-8");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      const method = init?.method ?? "GET";

      if (url.endsWith("/sync/session") && method === "POST") {
        return new Response(
          JSON.stringify({
            session_id: "sess-1",
            expires_at: new Date().toISOString(),
            plan: {
              to_upload: [{ entity_id: "e1", path: "files/entity.yaml", reason: "new", content_hash: "h", type: "system" }],
              to_download: [],
              conflicts: [],
            },
          }),
          { status: 200 }
        );
      }

      if (url.includes("/upload") && method === "POST") {
        return new Response(JSON.stringify({ uploaded: 1, total_uploaded: 1, pending: 0, progress: 80 }), { status: 200 });
      }

      if (url.includes("/commit") && method === "POST") {
        return new Response(JSON.stringify({ success: true, committed: ["e1"], new_snapshot: {} }), { status: 200 });
      }

      if (url.includes("/status") && method === "GET") {
        return new Response(JSON.stringify({ status: "committed", uploaded_count: 1, total_count: 1 }), { status: 200 });
      }

      if (method === "DELETE") {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }

      return new Response(JSON.stringify({ message: "unexpected" }), { status: 400 });
    }) as typeof fetch;

    try {
      const commitResult = await batchSync(
        [
          {
            entity_id: "e1",
            path: "files/entity.yaml",
            content_hash: "h",
            type: "system",
            updated_at: new Date().toISOString(),
          },
        ],
        "http://localhost",
        TMP_ROOT
      );
      expect(commitResult.success).toBe(true);

      await saveSessionState(TMP_ROOT, state);
      const resumed = await resumeSync("http://localhost", TMP_ROOT);
      expect(resumed?.success).toBe(true);

      await saveSessionState(TMP_ROOT, state);
      const cancelled = await cancelSync("http://localhost", TMP_ROOT);
      expect(cancelled).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("store handlers", () => {
  test("CRUD handlers operate through adapter", async () => {
    const entityId = `sys-${randomUUID()}`;
    const save = await storeSaveHandler({
      type: "system",
      data: { id: entityId, name: "System" },
      id: entityId,
    });
    expect(save.success).toBe(true);

    const read = await storeReadHandler({ id: entityId, format: "object" });
    expect(read.entity?.id).toBe(entityId);

    const list = await storeListHandler({ limit: 10 });
    expect(list.items?.some((item) => item.id === entityId)).toBe(true);

    const deleted = await storeDeleteHandler({ id: entityId });
    expect(deleted.success).toBe(true);
  });

  test("sync and plan sync handlers return expected shapes", async () => {
    const localId = `local-${randomUUID()}`;
    const dslPath = join(DSL_DIR, "systems", `${localId}.yaml`);
    mkdirSync(dirname(dslPath), { recursive: true });
    writeFileSync(dslPath, `id: ${localId}\nname: Local\ntype: system\n`, "utf-8");

    const imported = await storeSyncHandler({
      direction: "import",
      path: ".context/dsl",
      format: "yaml",
    });
    expect(imported.success).toBe(true);
    expect(imported.stats.created).toBeGreaterThan(0);

    const exported = await storeSyncHandler({
      direction: "export",
      path: ".context/export",
      format: "yaml",
      conflict_policy: "override",
    });
    expect(exported.success).toBe(true);
    const exportedFile = join(CONTEXT_DIR, "export", "systems", `${localId}.yaml`);
    expect(existsSync(exportedFile)).toBe(true);

    const planId = `plan-${randomUUID()}`;
    const plan = await storePlanSyncHandler({
      local_manifest: {
        files: [
          {
            entity_id: planId,
            path: `${planId}.yaml`,
            content_hash: "hash",
            type: "system",
            updated_at: new Date().toISOString(),
          },
        ],
      },
    });
    expect(plan.plan?.to_upload.length).toBe(1);
  });

  test("feat handlers cover lifecycle, checklist, merge, workflow", async () => {
    const featId = `feat-${randomUUID()}`;
    const lifecycle = await storeFeatLifecycleHandler({
      action: "create",
      feat_id: featId,
      metadata: { title: "feat", created_by: "tester" },
    });
    expect(lifecycle.success).toBe(true);

    const featEntityId = `feat-sys-${randomUUID()}`;
    const saved = await storeSaveHandler({
      type: "system",
      data: { id: featEntityId, name: "Feat System" },
      id: featEntityId,
      proposal_id: featId,
    });
    expect(saved.success).toBe(true);

    const checklist = await storeFeatChecklistHandler({
      action: "generate",
      feat_id: featId,
      source: "technical_spec",
    });
    expect(checklist.success).toBe(true);

    const store = SQLiteStore.getInstance({ dbPath: DB_PATH });
    const db = store.getDatabase();
    const workflowSteps = [
      { id: "step-1", status: "pending" },
    ];
    db.prepare("UPDATE feats SET workflow_steps = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(workflowSteps),
      new Date().toISOString(),
      featId
    );

    const workflowResult = await storeUpdateWorkflowStepHandler({
      feat_id: featId,
      step_id: "step-1",
      status: "completed",
    });
    expect(workflowResult.success).toBe(true);

    const mergeResult = await storeFeatMergeHandler({
      feat_id: featId,
      strategy: "auto",
    });
    expect(mergeResult.success).toBe(true);
  });

  test("history, backup/restore, repair, validate handlers", async () => {
    const store = SQLiteStore.getInstance({ dbPath: DB_PATH });
    const db = store.getDatabase();
    const historyId = `hist-${randomUUID()}`;
    db.prepare(`
      INSERT INTO entity_history (
        entity_id, source_project, proposal_id, entity_type, feat_id,
        action, changed_fields, changed_by, changed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(historyId, "alpha", "", "system", "", "archive", null, null, new Date().toISOString());

    const history = await storeReadHistoryHandler({ entity_id: historyId });
    expect(history.items?.[0]?.action).toBe("archive");

    const backupEntityId = `backup-${randomUUID()}`;
    await storeSaveHandler({
      type: "system",
      data: { id: backupEntityId, name: "Backup" },
      id: backupEntityId,
    });

    const backupFile = join(TMP_ROOT, "backup.json");
    const backupResult = await storeBackupHandler({
      output: backupFile,
      format: "json",
      status_filter: "all",
      include_metadata: true,
    });
    expect(backupResult.success).toBe(true);
    expect(existsSync(backupFile)).toBe(true);

    const restoreResult = await storeRestoreHandler({
      input: backupFile,
      conflict_policy: "override",
      validate_checksums: true,
    });
    expect(restoreResult.success).toBe(true);

    const repairResult = await storeRepairHandler({ scope: "all", dry_run: true });
    expect(repairResult.success).toBe(true);

    const validateResult = await storeValidateHandler({
      checks: ["references"],
      options: { check_depth: 1, include_suggestions: false },
    });
    expect(validateResult.success).toBe(true);
  });
});
