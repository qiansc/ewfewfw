/**
 * 错误类型定义
 */

export class DSLParseError extends Error {
  code = "PARSE_ERROR";

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "DSLParseError";
    this.cause = cause;
  }
}

export class DSLValidationError extends Error {
  code = "VALIDATION_ERROR";
  errors?: unknown[];

  constructor(message: string, errors?: unknown[]) {
    super(message);
    this.name = "DSLValidationError";
    this.errors = errors;
  }
}

export class TemplateNotFoundError extends Error {
  code = "TEMPLATE_NOT_FOUND";

  constructor(templateName: string) {
    super(`Template not found: ${templateName}`);
    this.name = "TemplateNotFoundError";
  }
}

export class SchemaNotFoundError extends Error {
  code = "SCHEMA_NOT_FOUND";

  constructor(type: string) {
    super(`Schema not found for type: ${type}`);
    this.name = "SchemaNotFoundError";
  }
}
