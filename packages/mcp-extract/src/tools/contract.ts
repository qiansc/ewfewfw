/**
 * c4a_extract_contract tool
 *
 * Generate API contracts (OpenAPI, AsyncAPI, Proto) from code
 */
import { stat } from "node:fs/promises";
import fg from "fast-glob";

import { parseFile, detectLanguage } from "../parsers/index.js";
import { getDisplayPath, resolveCodePath } from "../utils/pathGuard.js";
import type { ContractInput } from "../schemas/inputSchemas.js";
import type {
  CodeAnalysis,
  ExtractedInterface,
  ExtractedMethod,
  ContractEndpoint,
} from "../types/index.js";

export interface ContractResult {
  format: string;
  version: string;
  content: string;
  endpoints: ContractEndpoint[];
  schemas: string[];
  errors?: Array<{ file: string; error: string }>;
}

/**
 * Generate API contract from code
 */
export async function generateContract(
  input: ContractInput
): Promise<ContractResult> {
  const {
    path,
    format = "openapi",
    version = "3.0.0",
    title,
    description,
    baseUrl,
  } = input;

  const resolvedPath = await resolveCodePath(path);
  const errors: Array<{ file: string; error: string }> = [];

  // Collect all code analysis
  const analyses: CodeAnalysis[] = [];
  const pathStat = await stat(resolvedPath);

  if (pathStat.isFile()) {
    try {
      const analysis = await parseFile(resolvedPath);
      analysis.file = getDisplayPath(resolvedPath, resolvedPath, false);
      if (analysis.warnings) {
        errors.push(
          ...analysis.warnings.map((warning) => ({
            file: analysis.file,
            error: `warning: ${warning}`,
          }))
        );
      }
      analyses.push(analysis);
    } catch (error) {
      errors.push({
        file: getDisplayPath(resolvedPath, resolvedPath, false),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    const files = await fg(
      ["**/*.ts", "**/*.tsx", "**/*.go", "**/*.py"],
      {
        cwd: resolvedPath,
        ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
        absolute: true,
        followSymbolicLinks: false,
      }
    );

    for (const file of files) {
      try {
        const lang = detectLanguage(file);
        if (!lang) continue;

        const analysis = await parseFile(file, undefined, lang);
        analysis.file = getDisplayPath(file, resolvedPath, true);
        if (analysis.warnings) {
          errors.push(
            ...analysis.warnings.map((warning) => ({
              file: analysis.file,
              error: `warning: ${warning}`,
            }))
          );
        }
        analyses.push(analysis);
      } catch (error) {
        errors.push({
          file: getDisplayPath(file, resolvedPath, true),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Generate contract based on format
  switch (format) {
    case "openapi":
      return generateOpenAPI(analyses, { version, title, description, baseUrl, errors });
    case "asyncapi":
      return generateAsyncAPI(analyses, { version, title, description, errors });
    case "proto":
      return generateProto(analyses, { title, errors });
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

interface ContractOptions {
  version?: string;
  title?: string;
  description?: string;
  baseUrl?: string;
  errors?: Array<{ file: string; error: string }>;
}

/**
 * Generate OpenAPI spec
 */
function generateOpenAPI(
  analyses: CodeAnalysis[],
  options: ContractOptions
): ContractResult {
  const {
    version = "3.0.0",
    title = "API",
    description = "",
    baseUrl = "/",
    errors,
  } = options;

  // Collect all interfaces and methods
  const allInterfaces: ExtractedInterface[] = [];
  const allMethods: ExtractedMethod[] = [];

  for (const analysis of analyses) {
    if (!analysis.details) continue;
    allInterfaces.push(...analysis.details.interfaces);
    allMethods.push(...analysis.details.functions);
  }

  // Build OpenAPI spec
  const spec = {
    openapi: version,
    info: {
      title,
      description,
      version: "1.0.0",
    },
    servers: [{ url: baseUrl }],
    paths: buildOpenAPIPaths(allMethods),
    components: {
      schemas: buildOpenAPISchemas(allInterfaces),
    },
  };

  const endpoints: ContractEndpoint[] = [];

  // Extract endpoints from the spec
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, details] of Object.entries(methods as Record<string, unknown>)) {
      const d = details as { operationId?: string; summary?: string };
      endpoints.push({
        path,
        method: method.toUpperCase(),
        operationId: d.operationId,
        summary: d.summary,
      });
    }
  }

  return {
    format: "openapi",
    version,
    content: JSON.stringify(spec, null, 2),
    endpoints,
    schemas: allInterfaces.map((i) => i.name),
    errors: errors && errors.length > 0 ? errors : undefined,
  };
}

function buildOpenAPIPaths(
  methods: ExtractedMethod[]
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const method of methods) {
    // Skip private methods
    if (method.name.startsWith("_")) continue;

    // Infer HTTP method from name
    let httpMethod = "post";
    let pathName = `/${method.name}`;

    if (method.name.startsWith("get") || method.name.startsWith("fetch")) {
      httpMethod = "get";
      pathName = `/${method.name.replace(/^(get|fetch)/, "").toLowerCase() || method.name}`;
    } else if (method.name.startsWith("create") || method.name.startsWith("add")) {
      httpMethod = "post";
    } else if (method.name.startsWith("update") || method.name.startsWith("set")) {
      httpMethod = "put";
    } else if (method.name.startsWith("delete") || method.name.startsWith("remove")) {
      httpMethod = "delete";
    }

    if (!paths[pathName]) {
      paths[pathName] = {};
    }

    paths[pathName][httpMethod] = {
      operationId: method.name,
      summary: method.documentation || `${method.name} operation`,
      parameters: method.parameters
        .filter((p) => httpMethod === "get")
        .map((p) => ({
          name: p.name,
          in: "query",
          required: !p.optional,
          schema: { type: mapTypeToOpenAPI(p.type) },
        })),
      requestBody:
        httpMethod !== "get" && method.parameters.length > 0
          ? {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: Object.fromEntries(
                      method.parameters.map((p) => [
                        p.name,
                        { type: mapTypeToOpenAPI(p.type) },
                      ])
                    ),
                    required: method.parameters
                      .filter((p) => !p.optional)
                      .map((p) => p.name),
                  },
                },
              },
            }
          : undefined,
      responses: {
        "200": {
          description: "Success",
          content: {
            "application/json": {
              schema: { type: mapTypeToOpenAPI(method.returnType) },
            },
          },
        },
      },
    };
  }

  return paths;
}

function buildOpenAPISchemas(
  interfaces: ExtractedInterface[]
): Record<string, unknown> {
  const schemas: Record<string, unknown> = {};

  for (const iface of interfaces) {
    // Skip non-exported
    if (!iface.exported) continue;

    schemas[iface.name] = {
      type: "object",
      properties: Object.fromEntries(
        iface.properties.map((p) => [
          p.name,
          {
            type: mapTypeToOpenAPI(p.type),
            description: p.documentation,
          },
        ])
      ),
      required: iface.properties.filter((p) => !p.optional).map((p) => p.name),
    };
  }

  return schemas;
}

function mapTypeToOpenAPI(type: string): string {
  const t = type.toLowerCase();

  if (t.includes("string")) return "string";
  if (t.includes("number") || t.includes("int") || t.includes("float")) return "number";
  if (t.includes("boolean") || t.includes("bool")) return "boolean";
  if (t.includes("array") || t.includes("[]") || t.includes("list")) return "array";
  if (t.includes("object") || t.includes("dict") || t.includes("map")) return "object";

  return "string";
}

/**
 * Generate AsyncAPI spec
 */
function generateAsyncAPI(
  analyses: CodeAnalysis[],
  options: ContractOptions
): ContractResult {
  const {
    version = "2.6.0",
    title = "Async API",
    description = "",
    errors,
  } = options;

  const allInterfaces: ExtractedInterface[] = [];
  const allMethods: ExtractedMethod[] = [];

  for (const analysis of analyses) {
    if (!analysis.details) continue;
    allInterfaces.push(...analysis.details.interfaces);
    allMethods.push(...analysis.details.functions.filter((m) => m.async));
  }

  const spec = {
    asyncapi: version,
    info: {
      title,
      description,
      version: "1.0.0",
    },
    channels: buildAsyncAPIChannels(allMethods),
    components: {
      schemas: buildOpenAPISchemas(allInterfaces),
    },
  };

  const endpoints: ContractEndpoint[] = [];

  for (const [channel, details] of Object.entries(spec.channels)) {
    const d = details as { publish?: { operationId: string }; subscribe?: { operationId: string } };
    if (d.publish) {
      endpoints.push({
        path: channel,
        method: "PUBLISH",
        operationId: d.publish.operationId,
      });
    }
    if (d.subscribe) {
      endpoints.push({
        path: channel,
        method: "SUBSCRIBE",
        operationId: d.subscribe.operationId,
      });
    }
  }

  return {
    format: "asyncapi",
    version,
    content: JSON.stringify(spec, null, 2),
    endpoints,
    schemas: allInterfaces.map((i) => i.name),
    errors: errors && errors.length > 0 ? errors : undefined,
  };
}

function buildAsyncAPIChannels(
  methods: ExtractedMethod[]
): Record<string, unknown> {
  const channels: Record<string, unknown> = {};

  for (const method of methods) {
    if (!method.async) continue;

    const channelName = method.name.replace(/([A-Z])/g, "/$1").toLowerCase();

    channels[channelName] = {
      publish: {
        operationId: method.name,
        message: {
          payload: {
            type: "object",
            properties: Object.fromEntries(
              method.parameters.map((p) => [
                p.name,
                { type: mapTypeToOpenAPI(p.type) },
              ])
            ),
          },
        },
      },
    };
  }

  return channels;
}

/**
 * Generate Protocol Buffers definition
 */
function generateProto(
  analyses: CodeAnalysis[],
  options: ContractOptions
): ContractResult {
  const { title = "api", errors } = options;

  const allInterfaces: ExtractedInterface[] = [];
  const allMethods: ExtractedMethod[] = [];

  for (const analysis of analyses) {
    if (!analysis.details) continue;
    allInterfaces.push(...analysis.details.interfaces.filter((i) => i.exported));
    allMethods.push(...analysis.details.functions);
  }

  const lines: string[] = [
    'syntax = "proto3";',
    "",
    `package ${title.toLowerCase().replace(/[^a-z0-9]/g, "")};`,
    "",
    `option go_package = "./${title}";`,
    "",
  ];

  // Generate messages from interfaces
  for (const iface of allInterfaces) {
    lines.push(`message ${iface.name} {`);

    let fieldNum = 1;
    for (const prop of iface.properties) {
      const protoType = mapTypeToProto(prop.type);
      lines.push(`  ${protoType} ${prop.name} = ${fieldNum};`);
      fieldNum++;
    }

    lines.push("}");
    lines.push("");
  }

  // Generate service from methods
  if (allMethods.length > 0) {
    lines.push(`service ${capitalize(title)}Service {`);

    for (const method of allMethods) {
      const inputType = method.parameters.length > 0 ? `${capitalize(method.name)}Request` : "Empty";
      const outputType = method.returnType !== "void" ? `${capitalize(method.name)}Response` : "Empty";

      lines.push(`  rpc ${capitalize(method.name)}(${inputType}) returns (${outputType});`);
    }

    lines.push("}");
    lines.push("");

    // Generate request/response messages
    lines.push("message Empty {}");
    lines.push("");

    for (const method of allMethods) {
      if (method.parameters.length > 0) {
        lines.push(`message ${capitalize(method.name)}Request {`);
        let fieldNum = 1;
        for (const param of method.parameters) {
          const protoType = mapTypeToProto(param.type);
          lines.push(`  ${protoType} ${param.name} = ${fieldNum};`);
          fieldNum++;
        }
        lines.push("}");
        lines.push("");
      }

      if (method.returnType !== "void") {
        lines.push(`message ${capitalize(method.name)}Response {`);
        lines.push(`  ${mapTypeToProto(method.returnType)} result = 1;`);
        lines.push("}");
        lines.push("");
      }
    }
  }

  const endpoints: ContractEndpoint[] = allMethods.map((m) => ({
    path: `/${title.toLowerCase()}.${capitalize(title)}Service/${capitalize(m.name)}`,
    method: "RPC",
    operationId: m.name,
  }));

  return {
    format: "proto",
    version: "proto3",
    content: lines.join("\n"),
    endpoints,
    schemas: allInterfaces.map((i) => i.name),
    errors: errors && errors.length > 0 ? errors : undefined,
  };
}

function mapTypeToProto(type: string): string {
  const t = type.toLowerCase();

  if (t.includes("string")) return "string";
  if (t.includes("int64") || t.includes("long")) return "int64";
  if (t.includes("int") || t.includes("number")) return "int32";
  if (t.includes("float") || t.includes("double")) return "double";
  if (t.includes("bool")) return "bool";
  if (t.includes("bytes") || t.includes("buffer")) return "bytes";
  if (t.includes("[]") || t.includes("array") || t.includes("list")) {
    const inner = type.replace(/\[\]|array|list|<|>/gi, "").trim();
    return `repeated ${mapTypeToProto(inner)}`;
  }

  return "string";
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
