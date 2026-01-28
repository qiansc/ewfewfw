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

import type { ADR, Contract, ContractStatus, ADRStatus } from "../types/attached.js";
import type { LifecycleStatus, Perspective, EntityKind } from "../types/base.js";

// ============================================================================
// 辅助函数：推导 perspective 和 kind
// ============================================================================

/**
 * 根据实体类型和 ID 推导 perspective
 */
function inferPerspective(type: string, id: string): Perspective {
  if (type === 'product') return 'business';
  if (['system', 'container', 'component', 'adr', 'contract'].includes(type)) {
    return 'technical';
  }
  // process/sor 从 ID 前缀推导
  if (id.startsWith('prc-b-') || id.startsWith('sor-b-')) return 'business';
  if (id.startsWith('prc-t-') || id.startsWith('sor-t-')) return 'technical';
  // 默认技术视角（理论上不应该到这里，因为 ID 验证会拦截）
  return 'technical';
}

/**
 * 根据 external 字段推导 kind
 */
function inferKind(external?: boolean): EntityKind {
  return external ? 'external' : 'implementation';
}

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
    perspective: 'business', // Product 固定为业务视角
    kind: 'concept', // Product 是概念层面的知识
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
    perspective: 'technical', // System 固定为技术视角
    kind: inferKind(dsl.system.external),
    name: dsl.system.name,
    description: dsl.system.description,
    tags: dsl.system.tags,
    owner: dsl.system.owner,
    status: "draft",
    data: {
      corresponds_to: dsl.system.corresponds_to,
      external: dsl.system.external,
      external_info: dsl.system.external_info,
      // containers 字段在 System DSL 中不直接存储，而是通过 Container 的 system_id 反向关联
      // 此处设为 undefined，后续由存储层或查询层填充
      containers: undefined,
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
    perspective: 'technical', // Container 固定为技术视角
    kind: inferKind(dsl.container.external),
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
    perspective: 'technical', // Component 固定为技术视角
    kind: 'implementation', // Component 是实现层面的知识
    name: dsl.component.name,
    description: dsl.component.description,
    status: "draft",
    data: {
      container_id: dsl.component.container_id,
      technology: dsl.component.technology,
      code_path: dsl.component.code_path,
      implements_contracts: dsl.component.implements_contracts,
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
    perspective: inferPerspective('process', dsl.process.id),
    kind: 'concept', // Process 是概念层面的知识
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
    perspective: inferPerspective('sor', dsl.sor.id),
    kind: 'concept', // SoR 是概念层面的知识
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
 *
 * 注意：ADR 有独立的 ADRStatus（含 superseded），但 BaseEntityMetadata.status
 * 是 LifecycleStatus（不含 superseded）。因此需要两层映射：
 * - 顶层 status：映射到 LifecycleStatus（superseded → deprecated）
 * - data.status：保留原始 ADRStatus
 */
export function dslToADR(dsl: ADRDSL): ADR {
  // 映射到顶层 LifecycleStatus（BaseEntityMetadata.status）
  const lifecycleStatusMap: Record<string, LifecycleStatus> = {
    draft: "draft",
    approved: "approved",
    published: "published",
    deprecated: "deprecated",
    superseded: "deprecated", // superseded 映射到 deprecated
    archived: "archived",
  };
  const lifecycleStatus = lifecycleStatusMap[dsl.adr.status] || "draft";

  // 映射到 ADRStatus（data.status）
  // ADRStatus: draft | approved | published | deprecated | archived | superseded
  const adrStatusMap: Record<string, ADRStatus> = {
    draft: "draft",
    approved: "approved",
    published: "published",
    deprecated: "deprecated",
    superseded: "superseded",
    archived: "archived",
  };
  const adrStatus = adrStatusMap[dsl.adr.status] || "draft";

  return {
    id: dsl.adr.id,
    type: "adr",
    title: dsl.adr.title,
    // description 和 tags 在 ADR DSL 中不存在，内部类型可选
    data: {
      status: adrStatus,
      system_id: dsl.adr.system_id,
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
 *
 * 注意：Contract 有独立的 ContractStatus（含 implemented），但 BaseEntityMetadata.status
 * 是 LifecycleStatus（不含 implemented）。因此需要两层映射：
 * - 顶层 status：映射到 LifecycleStatus（implemented → approved）
 * - data.status：保留原始 ContractStatus
 */
export function dslToContract(dsl: ContractDSL): Contract {
  // 映射到顶层 LifecycleStatus（BaseEntityMetadata.status）
  const lifecycleStatusMap: Record<string, LifecycleStatus> = {
    draft: "draft",
    approved: "approved",
    implemented: "approved", // implemented 映射到 approved（已批准但未发布）
    published: "published",
    deprecated: "deprecated",
    archived: "archived",
  };
  const lifecycleStatus = lifecycleStatusMap[dsl.contract.status] || "draft";

  // 映射到 ContractStatus（data.status）
  const contractStatusMap: Record<string, ContractStatus> = {
    draft: "draft",
    approved: "approved",
    implemented: "implemented",
    published: "published",
    deprecated: "deprecated",
    archived: "deprecated", // archived 在 ContractStatus 中不存在，映射到 deprecated
  };
  const contractStatus = contractStatusMap[dsl.contract.status] || "draft";

  return {
    id: dsl.contract.id,
    type: "contract",
    scope: "project",
    name: dsl.contract.name,
    description: dsl.contract.description,
    status: lifecycleStatus,
    data: {
      contract_type: dsl.contract.contract_type,
      status: contractStatus,
      version: dsl.contract.version,
      implements_sor: dsl.contract.implements_sor,
      spec: dsl.spec as Record<string, unknown> | undefined,
      spec_uri: dsl.spec_uri,
    },
  };
}

// ============================================================================
// 反向转换：Internal → DSL
// 用于 c4a_store_read format: 'yaml' 输出和 Local Mode export
// ============================================================================

/**
 * Internal Product → Product DSL
 */
export function productToDSL(product: Product): ProductDSL {
  return {
    schema: "c4a/v1",
    type: "product",
    product: {
      id: product.id,
      name: product.name || "",
      description: product.description || "",
      scope: product.scope,
      owner: product.owner,
      tags: product.tags,
      based_on: product.data.based_on,
      reference_from: product.data.reference_from,
      doc_uri: product.data.doc_uri,
    },
    links: product.links,
  };
}

/**
 * Internal System → System DSL
 *
 * 注意：内部类型使用 'system'，DSL 使用 'software-system'
 */
export function systemToDSL(system: System): SystemDSL {
  return {
    schema: "c4a/v1",
    type: "software-system", // DSL 使用 software-system
    system: {
      id: system.id,
      name: system.name || "",
      description: system.description || "",
      // System DSL 只在 project 层存在，内部类型允许更宽的 scope 用于兼容
      scope: system.scope as 'project',
      owner: system.owner,
      tags: system.tags,
      corresponds_to: system.data.corresponds_to,
      external: system.data.external,
      external_info: system.data.external_info,
    },
  };
}

/**
 * Internal Container → Container DSL
 */
export function containerToDSL(container: Container): ContainerDSL {
  return {
    schema: "c4a/v1",
    type: "container",
    container: {
      id: container.id,
      name: container.name || "",
      description: container.description || "",
      // Container DSL 只在 project 层存在
      scope: container.scope as 'project',
      system_id: container.data.system_id,
      technology: container.data.technology,
      ports: container.data.ports,
      repository: container.data.repository,
      code_path: container.data.code_path,
      external: container.data.external,
      external_info: container.data.external_info,
      apis: container.data.apis,
    },
  };
}

/**
 * Internal Component → Component DSL
 */
export function componentToDSL(component: Component): ComponentDSL {
  return {
    schema: "c4a/v1",
    type: "component",
    component: {
      id: component.id,
      name: component.name || "",
      description: component.description || "",
      // Component DSL 只在 project 层存在
      scope: component.scope as 'project',
      container_id: component.data.container_id,
      technology: component.data.technology,
      code_path: component.data.code_path,
      implements_contracts: component.data.implements_contracts,
    },
  };
}

/**
 * Internal Process → Process DSL
 */
export function processToDSL(process: Process): ProcessDSL {
  return {
    schema: "c4a/v1",
    type: "process",
    process: {
      id: process.id,
      name: process.name || "",
      description: process.description || "",
      scope: process.scope,
      process_type: process.data.process_type,
      based_on: process.data.based_on,
      parent_id: process.data.parent_id,
      flow: process.data.flow,
    },
  };
}

/**
 * Internal SoR → SoR DSL
 */
export function sorToDSL(sor: SoR): SoRDSL {
  return {
    schema: "c4a/v1",
    type: "sor",
    sor: {
      id: sor.id,
      name: sor.name || "",
      description: sor.description || "",
      scope: sor.scope,
      sor_type: sor.data.sor_type,
      sor_subtype: sor.data.sor_subtype,
      entity_type: sor.data.entity_type,
      entity_id: sor.data.entity_id,
      process_id: sor.data.process_id,
      based_on: sor.data.based_on,
      corresponds_to: sor.data.corresponds_to,
    },
  };
}

/**
 * Internal ADR → ADR DSL
 *
 * 注意：使用 data.status（ADRStatus）而非顶层 status（LifecycleStatus）
 * 这样可以正确还原 superseded 状态
 */
export function adrToDSL(adr: ADR): ADRDSL {
  return {
    schema: "c4a/v1",
    type: "adr",
    adr: {
      id: adr.id,
      title: adr.title || "",
      // description 和 tags 在 ADR DSL 中不存在
      system_id: adr.data.system_id,
      status: adr.data.status, // 使用 data.status 保留完整语义（含 superseded）
      date: adr.data.date,
      authors: adr.data.authors,
      reviewers: adr.data.reviewers,
      approved_by: adr.data.approved_by,
      approved_at: adr.data.approved_at,
    },
    context: adr.data.context,
    decision: adr.data.decision,
    consequences: adr.data.consequences,
    alternatives: adr.data.alternatives?.map((alt) => ({
      name: alt.name,
      description: alt.description,
      pros: alt.pros,
      cons: alt.cons,
      // evaluation 在 DSL 中可能是 reason，但 Schema 定义是 evaluation
    })),
    related: adr.data.related,
  };
}

/**
 * Internal Contract → Contract DSL
 *
 * 注意：使用 data.status（ContractStatus）而非顶层 status（LifecycleStatus）
 * 这样可以正确还原 implemented 状态
 */
export function contractToDSL(contract: Contract): ContractDSL {
  return {
    schema: "c4a/v1",
    type: "contract",
    contract: {
      id: contract.id,
      name: contract.name || "",
      description: contract.description,
      contract_type: contract.data.contract_type,
      status: contract.data.status, // 使用 data.status 保留完整语义（含 implemented）
      version: contract.data.version,
      implements_sor: contract.data.implements_sor,
    },
    spec: contract.data.spec,
    spec_uri: contract.data.spec_uri,
  };
}
