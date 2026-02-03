/**
 * CLI 错误响应（与 MCP ErrorResponse 对齐）
 */
import type { ErrorResponse, RecoverableAction } from "@c4a/core/types";

export function buildErrorResponse(
  code: string,
  message: string,
  details?: ErrorResponse["details"],
  recoverableActions?: RecoverableAction[]
): ErrorResponse {
  return {
    code: code as ErrorResponse["code"],
    message,
    details,
    recoverable_actions: recoverableActions,
    timestamp: new Date().toISOString(),
  };
}

export function printErrorResponse(response: ErrorResponse): void {
  console.error(JSON.stringify(response, null, 2));
}
