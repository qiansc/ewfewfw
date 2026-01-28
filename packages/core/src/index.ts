/**
 * @c4a/core - C4A 核心共享库
 *
 * 提供 DSL 类型定义、Schema 验证、工具函数等共享能力
 */

// 内部业务类型（用于业务逻辑）
export * from "./types/index.js";

// DSL 文件类型（与 Schema 一致）
export * as DSL from "./types/dsl.js";

// 工具函数
export * from "./utils/index.js";
export * from "./utils/converter.js";
export {
  CONFIG_FILENAME,
  CONTEXT_ROOT_DIR,
  DSL_EXTENSION,
  BUSINESS_TYPES,
  TECHNICAL_TYPES,
  TYPE_TO_DIR,
  getPerspective,
  getPerspectiveFromId,
  getEntityPath,
  getFeatPath,
  getConfigPath,
  getAssetsPath,
  parseEntityPath,
} from "./utils/path.js";
export {
  parseYAML,
  parseYAMLSafe,
  stringifyYAML,
  validateYAMLSyntax,
} from "./utils/yaml.js";

// 验证器
export * from "./validator/index.js";
