/**
 * CLI 错误响应（与 MCP ErrorResponse 对齐）
 */

export interface ErrorResponse {
  code: string;
  message: string;
  details?: {
    field?: string;
    expected?: string;
    actual?: string;
    suggestion?: string;
  };
  timestamp: string;
  request_id?: string;
  recoverable_actions?: Array<{
    action: string;
    label: string;
    params?: object;
  }>;
}

export function buildErrorResponse(
  code: string,
  message: string,
  details?: ErrorResponse["details"]
): ErrorResponse {
  return {
    code,
    message,
    details,
    timestamp: new Date().toISOString(),
  };
}

export function createCliError(
  code: string,
  message: string,
  details?: ErrorResponse["details"]
): Error {
  const response = buildErrorResponse(code, message, details);
  return new Error(message, { cause: response });
}
