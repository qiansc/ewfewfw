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

export function createCliError(
  code: string,
  message: string,
  details?: ErrorResponse["details"],
  recoverableActions?: RecoverableAction[]
): Error {
  const response = buildErrorResponse(code, message, details, recoverableActions);
  return new Error(message, { cause: response });
}
