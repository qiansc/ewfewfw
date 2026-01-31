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
  details?: ErrorResponse["details"],
  recoverableActions?: ErrorResponse["recoverable_actions"]
): ErrorResponse {
  return {
    code,
    message,
    details,
    recoverable_actions: recoverableActions,
    timestamp: new Date().toISOString(),
  };
}

export function printErrorResponse(response: ErrorResponse): void {
  console.error(JSON.stringify(response, null, 2));
}
