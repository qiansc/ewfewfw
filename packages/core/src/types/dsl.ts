/**
 * C4A DSL 文件类型定义（与 JSON Schema 完全一致）
 *
 * 这些类型用于 DSL 文件解析和验证，与 Schema 结构保持一致。
 * 区别于 types/index.ts 中的内部业务类型。
 */

// 基础类型
export interface Owner {
  team?: string;
  tech_lead?: string;
  product_owner?: string;
  contact?: string;
}

export type Criticality = "critical" | "high" | "medium" | "low";
export type ContractStatus =
  | "draft"
  | "approved"
  | "implemented"
  | "published"
  | "deprecated";
export type ContractType = "openapi" | "protobuf" | "asyncapi" | "graphql";

export interface ExternalInfo {
  name: string;
  owner?: string;
  contact?: string;
}

export interface Link {
  type?: "repository" | "documentation" | "dashboard" | "wiki" | "other";
  url: string;
  description?: string;
}

export interface Example {
  title: string;
  type?: "scenario" | "code" | "request" | "response";
  content: string;
  language?: string;
}

export interface Constraint {
  performance?: {
    qps?: string;
    latency_p99?: string;
    latency_p95?: string;
    [key: string]: unknown;
  };
  security?: Record<string, unknown>;
  availability?: {
    sla?: string;
    rto?: string;
    rpo?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface Risk {
  id?: string;
  description: string;
  severity?: Criticality;
  mitigation?: string;
}

export interface Knowledge {
  examples?: Example[];
  how?: {
    architecture?: string;
    description?: string;
    [key: string]: unknown;
  };
  constraints?: Constraint;
  risks?: Risk[];
  links?: Link[];
  [key: string]: unknown;
}

// System DSL
export interface SystemDSL {
  schema: "c4a/v1";
  type: "software-system";
  system: {
    id: string;
    name: string;
    description: string;
    owner?: Owner;
    tags?: string[];
  };
  relationships?: {
    consumers?: Array<{
      id: string;
      type: "person" | "software-system";
      description?: string;
    }>;
    dependencies?: Array<{
      id: string;
      description?: string;
      technology?: string;
      criticality?: Criticality;
      external?: boolean;
      external_info?: ExternalInfo;
    }>;
  };
  knowledge?: Knowledge;
  containers?: {
    $ref?: string;
  };
  deployment?: {
    regions?: string[];
    environments?: string[];
    [key: string]: unknown;
  };
}

// Container DSL
export interface ContainerDSL {
  schema: "c4a/v1";
  type: "container";
  container: {
    id: string;
    name: string;
    description: string;
    technology: {
      language: string;
      framework?: string;
      runtime?: string;
      protocol: string;
    };
    ports?: Array<{
      port: number;
      protocol: "HTTP" | "gRPC" | "TCP" | "WebSocket";
      description?: string;
    }>;
    repository?: {
      url?: string;
      path?: string;
    };
    apis?: Array<{
      type: ContractType;
      ref: string;
      version?: string;
      status?: ContractStatus;
    }>;
    components?: string[]; // 该容器包含的组件 ID 列表
  };
  relationships?: Array<{
    to: string;
    description?: string;
    technology?: string;
    async?: boolean;
  }>;
  knowledge?: Knowledge;
}

// Component DSL
export interface ComponentDSL {
  schema: "c4a/v1";
  type: "component";
  component: {
    id: string;
    name: string;
    description: string;
    technology?: string;
  };
  relationships?: Array<{
    to: string;
    description?: string;
  }>;
  knowledge?: {
    responsibility?: string;
    api_tag?: string;
    how?: {
      description?: string;
      [key: string]: unknown;
    };
    interfaces?: Array<{
      name: string;
      description?: string;
    }>;
    [key: string]: unknown;
  };
}

// ADR DSL
export interface ADRDSL {
  schema: "c4a/v1";
  type: "adr";
  adr: {
    id: string; // ADR-001
    title: string;
    system_id?: string;
    status:
      | "draft"
      | "approved"
      | "implemented"
      | "published"
      | "deprecated"
      | "superseded";
    date?: string;
    authors?: string[];
    reviewers?: string[];
    approved_by?: string;
    approved_at?: string;
  };
  context: string;
  decision: string;
  consequences?: {
    positive?: string[];
    negative?: string[];
    neutral?: string[];
  };
  alternatives?: Array<{
    name: string;
    description?: string;
    pros?: string[];
    cons?: string[];
    evaluation?: number; // 1-5
  }>;
  affects?: Array<{
    element_type: "system" | "container" | "component";
    element_id: string;
    scope?: string;
  }>;
  related?: {
    supersedes?: string;
    superseded_by?: string;
    related_adrs?: string[];
    related_contracts?: string[];
  };
  content?: string;
}

// Contract DSL
export interface ContractDSL {
  schema: "c4a/v1";
  type: "contract";
  contract: {
    id: string;
    name: string;
    description?: string;
    container_id?: string;
    contract_type: ContractType;
    status: ContractStatus;
    version?: string; // v1.2.0
  };
  content?: string;
  metadata?: {
    created_at?: string;
    updated_at?: string;
    created_by?: string;
    approved_by?: string;
    approved_at?: string;
  };
  validation?: {
    last_validated_at?: string;
    success?: boolean;
    errors?: string[];
    warnings?: string[];
  };
  related?: {
    adr_id?: string;
    consumers?: string[];
    supersedes?: string;
    superseded_by?: string;
  };
  breaking_changes?: Array<{
    version: string;
    description: string;
    migration_guide?: string;
  }>;
}

// 联合类型
export type C4ADSL =
  | SystemDSL
  | ContainerDSL
  | ComponentDSL
  | ADRDSL
  | ContractDSL;
