import { describe, expect, test } from "bun:test";
import type {
  DepsNode,
  DepsParams,
  ImpactNode,
  ImpactParams,
  SearchParams,
  SearchResult,
} from "@c4a/storage";
import { queryDepsHandler } from "../tools/deps.js";
import { queryImpactHandler } from "../tools/impact.js";
import { querySearchHandler } from "../tools/search.js";

describe("mcp-query handlers", () => {
  test("search maps adapter results and normalizes search_mode", async () => {
    const adapter = {
      async initialize() {},
      async search(_params: SearchParams): Promise<SearchResult> {
        return {
          items: [
            {
              id: "sys-1",
              type: "system",
              score: 0.9,
              snippet: "hello world",
              metadata: {},
            },
          ],
          degraded: true,
          degraded_reason: "FULLTEXT_SEARCH_UNAVAILABLE",
          degraded_message: "fallback",
          search_mode: "like",
          total: 42,
          has_more: true,
        };
      },
      async queryDeps(_params: DepsParams): Promise<DepsNode[]> {
        return [];
      },
      async queryImpact(_params: ImpactParams): Promise<ImpactNode[]> {
        return [];
      },
    };

    const result = await querySearchHandler(
      { query: "hello", limit: 5, offset: 10 },
      { adapter }
    );

    expect(result.items[0]).toEqual({
      id: "sys-1",
      type: "system",
      score: 0.9,
      summary: "hello world",
    });
    expect(result.search_mode).toBe("fulltext");
    expect(result.pagination?.limit).toBe(5);
    expect(result.pagination?.offset).toBe(10);
    expect(result.pagination?.total).toBe(42);
    expect(result.pagination?.has_more).toBe(true);
    expect(result.degraded).toBe(true);
  });

  test("deps returns degraded context when provided", async () => {
    const adapter = {
      async initialize() {},
      async search(_params: SearchParams): Promise<SearchResult> {
        return {
          items: [],
          degraded: false,
          search_mode: "vector",
        };
      },
      async queryDeps(_params: DepsParams): Promise<DepsNode[]> {
        return [
          {
            id: "dep-1",
            source_project: "alpha",
            type: "component",
            distance: 1,
            relation_type: "depends_on",
          },
        ];
      },
      async queryImpact(_params: ImpactParams): Promise<ImpactNode[]> {
        return [];
      },
    };

    const result = await queryDepsHandler(
      { id: "svc-1", direction: "downstream", proposal_id: null },
      {
        adapter,
        checkSyncStatus: async () => ({
          degraded: true,
          degraded_reason: "PENDING_SYNC",
          degraded_message: "pending",
        }),
      }
    );

    expect(result.items[0]?.id).toBe("dep-1");
    expect(result.degraded).toBe(true);
    expect(result.degraded_reason).toBe("PENDING_SYNC");
  });

  test("impact returns simplified result in local mode", async () => {
    const adapter = {
      async initialize() {},
      async search(_params: SearchParams): Promise<SearchResult> {
        return {
          items: [],
          degraded: false,
          search_mode: "vector",
        };
      },
      async queryDeps(_params: DepsParams): Promise<DepsNode[]> {
        return [];
      },
      async queryImpact(_params: ImpactParams): Promise<ImpactNode[]> {
        return [
          {
            id: "dep-1",
            source_project: "alpha",
            type: "component",
            distance: 1,
            impact_level: "direct",
          },
        ];
      },
    };

    const result = await queryImpactHandler(
      { id: "svc-1", proposal_id: null },
      {
        adapter,
        checkSyncStatus: async () => ({ degraded: false }),
        isLocalMode: () => true,
      }
    );

    expect(result.success).toBe(true);
    if ("items" in result) {
      expect(result.items[0]?.id).toBe("dep-1");
      expect(result.degraded_reason).toBe("LOCAL_MODE_SIMPLIFIED");
    }
  });

  test("impact returns error when degraded in server mode", async () => {
    let called = false;
    const adapter = {
      async initialize() {},
      async search(_params: SearchParams): Promise<SearchResult> {
        return {
          items: [],
          degraded: false,
          search_mode: "vector",
        };
      },
      async queryDeps(_params: DepsParams): Promise<DepsNode[]> {
        return [];
      },
      async queryImpact(_params: ImpactParams): Promise<ImpactNode[]> {
        called = true;
        return [];
      },
    };

    const result = await queryImpactHandler(
      { id: "svc-1", proposal_id: null },
      {
        adapter,
        checkSyncStatus: async () => ({
          degraded: true,
          degraded_reason: "PENDING_SYNC",
        }),
        isLocalMode: () => false,
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("DEGRADED_MODE_UNSUPPORTED");
    expect(called).toBe(false);
  });
});
