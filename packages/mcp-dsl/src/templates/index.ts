/**
 * DSL 模板定义
 */

const systemTemplate = `schema: c4a/v1
type: software-system

system:
  id: {{id}}
  name: {{name}}
  description: {{description}}
  owner:
    team: ""
    tech_lead: ""

relationships:
  dependencies: []

knowledge:
  examples: []
  links: []
`;

const containerTemplate = `schema: c4a/v1
type: container

container:
  id: {{id}}
  name: {{name}}
  description: {{description}}
  technology:
    language: TypeScript
    framework: ""
    runtime: Bun
    protocol: HTTP
  ports:
    - port: 8080
      protocol: HTTP
      description: Main API
  # components: []  # 该容器包含的组件 ID 列表

relationships: []

knowledge:
  examples: []
`;

const componentTemplate = `schema: c4a/v1
type: component

component:
  id: {{id}}
  name: {{name}}
  description: {{description}}
  technology: ""

relationships: []

knowledge:
  responsibility: ""
  interfaces: []
`;

const adrTemplate = `schema: c4a/v1
type: adr

adr:
  id: ADR-{{number}}
  title: {{name}}
  status: draft
  date: {{date}}
  authors: []
  reviewers: []

context: |
  {{description}}

decision: |
  我们决定...

consequences:
  positive: []
  negative: []
  neutral: []

alternatives: []
`;

export const templates: Record<string, string> = {
  system: systemTemplate,
  container: containerTemplate,
  component: componentTemplate,
  adr: adrTemplate,
};

export function getTemplate(type: string): string | null {
  return templates[type] || null;
}

export function renderTemplate(
  template: string,
  data: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}
