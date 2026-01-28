/**
 * C4A Schema 验证工具
 *
 * 用于运行时验证 DSL 数据
 * 复用 validator/ 模块的底层实现
 */

import { getAjv, getValidator, clearCache } from '../validator/ajvInstance.js';
import type { EntityType } from '../types/base.js';

// ============================================================================
// 验证结果类型
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ============================================================================
// Schema 类型映射
// ============================================================================

const SCHEMA_MAP: Record<string, string> = {
  product: 'c4a-product.schema.json',
  system: 'c4a-system.schema.json',
  container: 'c4a-container.schema.json',
  component: 'c4a-component.schema.json',
  process: 'c4a-process.schema.json',
  sor: 'c4a-sor.schema.json',
  adr: 'c4a-adr.schema.json',
  contract: 'c4a-contract.schema.json',
  feat: 'c4a-feat.schema.json',
  checklist: 'c4a-checklist.schema.json',
};

// ============================================================================
// 验证函数
// ============================================================================

/**
 * 注册 Schema
 */
export function registerSchema(schemaId: string, schema: object): void {
  const ajv = getAjv();
  if (!ajv.getSchema(schemaId)) {
    ajv.addSchema(schema, schemaId);
  }
}

/**
 * 验证数据
 */
export function validateSchema(
  data: unknown,
  schemaId: string,
): ValidationResult {
  const ajv = getAjv();
  const validate = ajv.getSchema(schemaId);

  if (!validate) {
    return {
      valid: false,
      errors: [{ path: '', message: `Schema not found: ${schemaId}`, keyword: 'schema' }],
    };
  }

  const valid = validate(data);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = (validate.errors || []).map((err: any) => ({
    path: err.instancePath || '/',
    message: err.message || 'Unknown error',
    keyword: err.keyword,
  }));

  return { valid: false, errors };
}

/**
 * 按实体类型验证
 */
export function validateEntity(
  data: unknown,
  type: EntityType | 'checklist',
): ValidationResult {
  // 优先使用 validator 模块的预编译验证器
  const validatorType = type === 'checklist' ? null : type;
  if (validatorType && ['product', 'system', 'container', 'component', 'process', 'sor', 'adr', 'contract'].includes(validatorType)) {
    const validator = getValidator(validatorType as 'product' | 'system' | 'container' | 'component' | 'process' | 'sor' | 'adr' | 'contract');
    if (validator) {
      const valid = validator(data);
      if (valid) {
        return { valid: true, errors: [] };
      }
      const errors: ValidationError[] = (validator.errors || []).map((err: any) => ({
        path: err.instancePath || '/',
        message: err.message || 'Unknown error',
        keyword: err.keyword,
      }));
      return { valid: false, errors };
    }
  }

  // 回退到通用 Schema 验证
  const schemaFile = SCHEMA_MAP[type];
  if (!schemaFile) {
    return {
      valid: false,
      errors: [{ path: '', message: `Unknown entity type: ${type}`, keyword: 'type' }],
    };
  }
  return validateSchema(data, schemaFile);
}

/**
 * 格式化验证错误为字符串
 */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.valid) return '';
  return result.errors
    .map((e) => `${e.path}: ${e.message}`)
    .join('\n');
}

/**
 * 清除 Schema 缓存（用于测试）
 */
export { clearCache };
