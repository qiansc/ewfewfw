import type {
  DepsParams,
  DepsResult,
  ImpactParams,
  ImpactResult,
  SearchParams,
  SearchResult,
} from "@c4a/storage";
import type { SyncStatusChecker } from "./checkSyncStatus.js";

export interface QueryAdapter {
  initialize(): Promise<void>;
  search(params: SearchParams): Promise<SearchResult>;
  queryDeps(params: DepsParams): Promise<DepsResult>;
  queryImpact(params: ImpactParams): Promise<ImpactResult>;
}

export interface QueryHandlerOptions {
  adapter?: QueryAdapter;
  checkSyncStatus?: SyncStatusChecker;
  isLocalMode?: () => boolean;
}
