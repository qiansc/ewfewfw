/**
 * C4A DSL 类型定义
 */

// 基础类型
export interface C4AMetadata {
  id: string;
  name: string;
  description?: string;
  version?: string;
  created_at?: string;
  updated_at?: string;
}

// System 层类型
export interface C4ASystem extends C4AMetadata {
  type: "system";
  external?: boolean;
  external_info?: ExternalInfo;
  containers?: string[];
  relations?: Relation[];
  knowledge?: Knowledge;
}

// Container 层类型
export interface C4AContainer extends C4AMetadata {
  type: "container";
  system_id: string;
  technology?: string;
  external?: boolean;
  external_info?: ExternalInfo;
  components?: string[];
  relations?: Relation[];
  knowledge?: Knowledge;
}

// Component 层类型
export interface C4AComponent extends C4AMetadata {
  type: "component";
  container_id: string;
  technology?: string;
  responsibility?: string;
  relations?: Relation[];
  knowledge?: Knowledge;
}

// ADR 类型
export interface C4AADR extends C4AMetadata {
  type: "adr";
  status: ADRStatus;
  context: string;
  decision: string;
  consequences?: string;
  related_systems?: string[];
  related_containers?: string[];
}

// 契约类型
export interface C4AContract extends C4AMetadata {
  type: "contract";
  format: ContractFormat;
  status: ContractStatus;
  content: string;
  related_component?: string;
}

// 关系类型
export interface Relation {
  target: string;
  type: RelationType;
  description?: string;
  technology?: string;
}

// External 信息
export interface ExternalInfo {
  name: string;
  description?: string;
  url?: string;
  contact?: string;
}

// Knowledge 类型
export interface Knowledge {
  examples?: Example[];
  decisions?: string[];
  constraints?: Constraint[];
  risks?: Risk[];
  history?: HistoryEntry[];
  how?: HowTo[];
  links?: Link[];
}

export interface Example {
  name: string;
  description: string;
  scenario?: string;
}

export interface Constraint {
  name: string;
  description: string;
  type: "technical" | "business" | "regulatory";
}

export interface Risk {
  name: string;
  description: string;
  impact: "low" | "medium" | "high";
  mitigation?: string;
}

export interface HistoryEntry {
  date: string;
  description: string;
  author?: string;
}

export interface HowTo {
  title: string;
  description: string;
  steps?: string[];
}

export interface Link {
  title: string;
  url: string;
  type?: "doc" | "repo" | "api" | "other";
}

// 枚举类型
export type RelationType = "uses" | "depends_on" | "calls" | "sends" | "receives" | "stores";
export type ADRStatus = "draft" | "approved" | "deprecated";
export type ContractStatus = "draft" | "approved" | "implemented" | "published" | "deprecated";
export type ContractFormat = "openapi" | "asyncapi" | "proto" | "graphql" | "custom";

// DSL 文件类型
export type C4ADSL = C4ASystem | C4AContainer | C4AComponent | C4AADR | C4AContract;
