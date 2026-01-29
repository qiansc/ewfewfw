import type {
  DepsNode,
  DepsParams,
  ImpactNode,
  ImpactParams,
  SearchParams,
  SearchResult,
} from "@c4a/storage";
import type { SyncStatusChecker } from "./checkSyncStatus.js";

export interface QueryAdapter {
  initialize(): Promise<void>;
  search(params: SearchParams): Promise<SearchResult>;
  queryDeps(params: DepsParams): Promise<DepsNode[]>;
  queryImpact(params: ImpactParams): Promise<ImpactNode[]>;
}

export interface QueryHandlerOptions {
  adapter?: QueryAdapter;
  checkSyncStatus?: SyncStatusChecker;
  isLocalMode?: () => boolean;
}
