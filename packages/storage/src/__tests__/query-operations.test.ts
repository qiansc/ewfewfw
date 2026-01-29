import { describe, expect, test } from "bun:test";
import { GraphQueryCache } from "../graph-query-cache.js";
import { InMemoryGraph } from "../in-memory-graph.js";
import { queryDeps, queryImpact } from "../lite-adapter/graph-operations.js";
import type { AdapterContext } from "../lite-adapter/types.js";
import type { SQLiteStore } from "../sqlite-store.js";

function createContext(graph: InMemoryGraph, defaultProject = "alpha"): AdapterContext {
  const store = {
    getDatabase: () => {
      throw new Error("Unexpected database access in query-operations tests");
    },
  } as unknown as SQLiteStore;

  return {
    store,
    graph,
    cache: new GraphQueryCache(),
    config: {
      dbPath: "memory",
      defaultProject,
      enableVectorSearch: false,
      repoId: null,
      feat: {
        concurrent_warning: true,
        auto_notify: false,
      },
    },
  };
}

describe("query operations", () => {
  test("queryDeps returns downstream nodes", async () => {
    const graph = new InMemoryGraph();
    graph.addRelation("alpha", "svc", "alpha", "dep", "depends_on");
    graph.addRelation("alpha", "dep", "alpha", "leaf", "depends_on");

    const ctx = createContext(graph);
    const results = await queryDeps(ctx, {
      id: "svc",
      source_project: "alpha",
      direction: "downstream",
      depth: 2,
    });

    const ids = results.map((node) => node.id);
    expect(ids).toEqual(expect.arrayContaining(["dep", "leaf"]));
  });

  test("queryImpact assigns direct/indirect levels", async () => {
    const graph = new InMemoryGraph();
    graph.addRelation("alpha", "svc", "alpha", "dep", "depends_on");
    graph.addRelation("alpha", "dep", "alpha", "leaf", "depends_on");

    const ctx = createContext(graph);
    const results = await queryImpact(ctx, {
      id: "svc",
      source_project: "alpha",
      depth: 2,
      change_type: "remove",
    });

    const direct = results.find((node) => node.id === "dep");
    const indirect = results.find((node) => node.id === "leaf");
    expect(direct?.impact_level).toBe("direct");
    expect(indirect?.impact_level).toBe("indirect");
    expect(direct?.reason).toBe("breaking");
  });
});
