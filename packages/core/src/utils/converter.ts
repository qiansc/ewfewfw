/**
 * DSL 类型与内部类型转换工具
 *
 * 用于将 DSL 文件格式转换为内部存储格式
 */
import type {
  SystemDSL,
  ContainerDSL,
  ComponentDSL,
  ADRDSL,
  ContractDSL,
  ProductDSL,
  ProcessDSL,
  SoRDSL,
} from "../types/dsl.js";

import type {
  System,
  Container,
  Component,
  Product,
  Process,
  SoR,
} from "../types/entities.js";

import type { ADR, Contract } from "../types/attached.js";

/**
 * 类型保护：检查是否为 Product DSL
 */
export function isProductDSL(data: unknown): data is ProductDSL {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as ProductDSL).type === "product"
  );
}

/**
 * 类型保护：检查是否为 System DSL
 */
export function isSystemDSL(data: unknown): data is SystemDSL {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as SystemDSL).type === "software-system"
  );
}

/**
 * 类型保护：检查是否为 Container DSL
 */
export function isContainerDSL(data: unknown): data is ContainerDSL {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as ContainerDSL).type === "container"
  );
}

/**
 * 类型保护：检查是否为 Component DSL
 */
export function isComponentDSL(data: unknown): data is ComponentDSL {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as ComponentDSL).type === "component"
  );
}

/**
 * 类型保护：检查是否为 Process DSL
 */
export function isProcessDSL(data: unknown): data is ProcessDSL {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as ProcessDSL).type === "process"
  );
}

/**
 * 类型保护：检查是否为 SoR DSL
 */
export function isSoRDSL(data: unknown): data is SoRDSL {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as SoRDSL).type === "sor"
  );
}

/**
 * 类型保护：检查是否为 ADR DSL
 */
export function isADRDSL(data: unknown): data is ADRDSL {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as ADRDSL).type === "adr"
  );
}

/**
 * 类型保护：检查是否为 Contract DSL
 */
export function isContractDSL(data: unknown): data is ContractDSL {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as ContractDSL).type === "contract"
  );
}

/**
 * Product DSL → Internal Product
 */
export function dslToProduct(dsl: ProductDSL): Product {
  return {
    id: dsl.product.id,
    type: "product",
    scope: dsl.product.scope,
    name: dsl.product.name,
    description: dsl.product.description,
    tags: dsl.product.tags,
    owner: dsl.product.owner,
    links: dsl.links,
    status: "draft",
    data: {
      based_on: dsl.product.based_on,
      reference_from: dsl.product.reference_from,
      doc_uri: dsl.product.doc_uri,
    },
  };
}

/**
 * System DSL → Internal System
 */
export function dslToSystem(dsl: SystemDSL): System {
  return {
    id: dsl.system.id,
    type: "system",
    scope: "project",
    name: dsl.system.name,
    description: dsl.system.description,
    tags: dsl.system.tags,
    owner: dsl.system.owner,
    status: "draft",
    data: {
      corresponds_to: dsl.system.corresponds_to,
      external: dsl.system.external,
      external_info: dsl.system.external_info,
      containers: dsl.relationships?.dependencies?.map((d) => d.id),
    },
  };
}

/**
 * Container DSL → Internal Container
 */
export function dslToContainer(dsl: ContainerDSL): Container {
  return {
    id: dsl.container.id,
    type: "container",
    scope: "project",
    name: dsl.container.name,
    description: dsl.container.description,
    status: "draft",
    data: {
      system_id: dsl.container.system_id,
      technology: dsl.container.technology,
      ports: dsl.container.ports,
      repository: dsl.container.repository,
      code_path: dsl.container.code_path,
      external: dsl.container.external,
      external_info: dsl.container.external_info,
      apis: dsl.container.apis,
    },
  };
}

/**
 * Component DSL → Internal Component
 */
export function dslToComponent(dsl: ComponentDSL): Component {
  return {
    id: dsl.component.id,
    type: "component",
    scope: "project",
    name: dsl.component.name,
    description: dsl.component.description,
    status: "draft",
    data: {
      container_id: dsl.component.container_id,
      technology: dsl.component.technology,
      responsibility: dsl.component.responsibility,
      code_path: dsl.component.code_path,
      implements_contract: dsl.component.implements_contract,
    },
  };
}

/**
 * Process DSL → Internal Process
 */
export function dslToProcess(dsl: ProcessDSL): Process {
  return {
    id: dsl.process.id,
    type: "process",
    scope: dsl.process.scope,
    name: dsl.process.name,
    description: dsl.process.description,
    status: "draft",
    data: {
      process_type: dsl.process.process_type,
      based_on: dsl.process.based_on,
      parent_id: dsl.process.parent_id,
      description: dsl.process.description,
      flow: dsl.process.flow,
    },
  };
}

/**
 * SoR DSL → Internal SoR
 */
export function dslToSoR(dsl: SoRDSL): SoR {
  return {
    id: dsl.sor.id,
    type: "sor",
    scope: dsl.sor.scope,
    name: dsl.sor.name,
    description: dsl.sor.description,
    status: "draft",
    data: {
      sor_type: dsl.sor.sor_type,
      sor_subtype: dsl.sor.sor_subtype,
      entity_type: dsl.sor.entity_type,
      entity_id: dsl.sor.entity_id,
      process_id: dsl.sor.process_id,
      based_on: dsl.sor.based_on,
      corresponds_to: dsl.sor.corresponds_to,
    },
  };
}

/**
 * ADR DSL → Internal ADR
 */
export function dslToADR(dsl: ADRDSL): ADR {
  // 映射 DSL 状态到内部状态
  const statusMap: Record<string, "draft" | "approved" | "published" | "deprecated" | "archived"> = {
    draft: "draft",
    proposed: "draft",
    approved: "approved",
    implemented: "published",
    published: "published",
    deprecated: "deprecated",
    superseded: "deprecated",
    archived: "archived",
  };
  const status = statusMap[dsl.adr.status] || "draft";

  // 映射到 ADRStatus
  const adrStatusMap: Record<string, "draft" | "proposed" | "approved" | "implemented" | "published" | "deprecated" | "superseded"> = {
    draft: "draft",
    proposed: "proposed",
    approved: "approved",
    implemented: "implemented",
    published: "published",
    deprecated: "deprecated",
    superseded: "superseded",
    archived: "deprecated",
  };
  const adrStatus = adrStatusMap[dsl.adr.status] || "draft";

  return {
    id: dsl.adr.id,
    type: "adr",
    scope: "project",
    name: dsl.adr.title,
    status,
    data: {
      adr_status: adrStatus,
      date: dsl.adr.date,
      authors: dsl.adr.authors,
      reviewers: dsl.adr.reviewers,
      approved_by: dsl.adr.approved_by,
      approved_at: dsl.adr.approved_at,
      context: dsl.context,
      decision: dsl.decision,
      consequences: dsl.consequences,
      alternatives: dsl.alternatives,
      related: dsl.related,
    },
  };
}

/**
 * Contract DSL → Internal Contract
 */
export function dslToContract(dsl: ContractDSL): Contract {
  // 映射 DSL 状态到 ContractStatus
  const contractStatusMap: Record<string, "draft" | "approved" | "implemented" | "published" | "deprecated"> = {
    draft: "draft",
    approved: "approved",
    implemented: "implemented",
    published: "published",
    deprecated: "deprecated",
    archived: "deprecated",
  };
  const contractStatus = contractStatusMap[dsl.contract.status] || "draft";

  return {
    id: dsl.contract.id,
    type: "contract",
    scope: "project",
    name: dsl.contract.name,
    description: dsl.contract.description,
    status: dsl.contract.status,
    data: {
      contract_type: dsl.contract.contract_type,
      contract_status: contractStatus,
      version: dsl.contract.version,
      component_id: dsl.contract.component_id,
      implements_sor: dsl.contract.implements_sor,
      spec: dsl.spec as Record<string, unknown> | undefined,
      spec_uri: dsl.spec_uri,
    },
  };
}
