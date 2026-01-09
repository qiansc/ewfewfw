/**
 * DSL 类型与内部类型转换工具
 */
import type * as DSL from "../types/dsl.js";
import type * as Internal from "../types/index.js";

/**
 * 类型保护：检查是否为 System DSL
 */
export function isSystemDSL(data: unknown): data is DSL.SystemDSL {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as DSL.SystemDSL).type === "software-system"
  );
}

/**
 * 类型保护：检查是否为 Container DSL
 */
export function isContainerDSL(data: unknown): data is DSL.ContainerDSL {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as DSL.ContainerDSL).type === "container"
  );
}

/**
 * 类型保护：检查是否为 Component DSL
 */
export function isComponentDSL(data: unknown): data is DSL.ComponentDSL {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as DSL.ComponentDSL).type === "component"
  );
}

/**
 * 类型保护：检查是否为 ADR DSL
 */
export function isADRDSL(data: unknown): data is DSL.ADRDSL {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as DSL.ADRDSL).type === "adr"
  );
}

/**
 * 类型保护：检查是否为 Contract DSL
 */
export function isContractDSL(data: unknown): data is DSL.ContractDSL {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as DSL.ContractDSL).type === "contract"
  );
}

/**
 * System DSL → Internal System
 */
export function dslToSystem(dsl: DSL.SystemDSL): Internal.C4ASystem {
  return {
    type: "system",
    id: dsl.system.id,
    name: dsl.system.name,
    description: dsl.system.description,
    version: "1.0.0",
    external:
      dsl.relationships?.dependencies?.some((d) => d.external) ?? false,
    containers: [],
    relations: dsl.relationships?.dependencies?.map((d) => ({
      target: d.id,
      type: "depends_on" as const,
      description: d.description,
      technology: d.technology,
    })),
    knowledge: convertKnowledge(dsl.knowledge),
  };
}

/**
 * Container DSL → Internal Container
 */
export function dslToContainer(
  dsl: DSL.ContainerDSL,
  systemId: string
): Internal.C4AContainer {
  return {
    type: "container",
    id: dsl.container.id,
    name: dsl.container.name,
    description: dsl.container.description,
    system_id: systemId,
    technology: `${dsl.container.technology.language} / ${dsl.container.technology.protocol}`,
    external: false,
    components: [],
    relations: dsl.relationships?.map((r) => ({
      target: r.to,
      type: "uses" as const,
      description: r.description,
      technology: r.technology,
    })),
    knowledge: convertKnowledge(dsl.knowledge),
  };
}

/**
 * Component DSL → Internal Component
 */
export function dslToComponent(
  dsl: DSL.ComponentDSL,
  containerId: string
): Internal.C4AComponent {
  return {
    type: "component",
    id: dsl.component.id,
    name: dsl.component.name,
    description: dsl.component.description,
    container_id: containerId,
    technology: dsl.component.technology,
    responsibility: dsl.knowledge?.responsibility,
    relations: dsl.relationships?.map((r) => ({
      target: r.to,
      type: "calls" as const,
      description: r.description,
    })),
    knowledge: convertComponentKnowledge(dsl.knowledge),
  };
}

/**
 * Knowledge 转换辅助函数
 */
function convertKnowledge(
  knowledge?: DSL.Knowledge
): Internal.Knowledge | undefined {
  if (!knowledge) return undefined;

  return {
    examples: knowledge.examples?.map((e) => ({
      name: e.title,
      description: e.content,
      scenario: e.type,
    })),
    how: knowledge.how
      ? [
          {
            title: "Implementation",
            description:
              knowledge.how.description || knowledge.how.architecture || "",
          },
        ]
      : undefined,
    links: knowledge.links?.map((l) => ({
      title: l.description || l.url,
      url: l.url,
      type: l.type === "repository" ? ("repo" as const) : ("other" as const),
    })),
    risks: knowledge.risks?.map((r) => ({
      name: r.id || "Risk",
      description: r.description,
      impact: (r.severity as "low" | "medium" | "high") || "medium",
      mitigation: r.mitigation,
    })),
  };
}

/**
 * Component Knowledge 转换
 */
function convertComponentKnowledge(
  knowledge?: DSL.ComponentDSL["knowledge"]
): Internal.Knowledge | undefined {
  if (!knowledge) return undefined;

  return {
    how: knowledge.how
      ? [
          {
            title: "Implementation",
            description: knowledge.how.description || "",
          },
        ]
      : undefined,
  };
}
