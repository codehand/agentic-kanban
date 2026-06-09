/**
 * errors.ts — Domain error → MCP error mapping.
 *
 * The MCP protocol uses JSON-RPC error codes. Tool handlers return an error
 * result (with `isError: true`) rather than throwing, so clients see a
 * structured message. This module classifies thrown domain errors and maps
 * them to human-readable MCP tool error responses.
 *
 * Per TASK_HUB_DESIGN.md §6: wrong-role, missing-task, and invalid-input
 * failures all surface as MCP tool errors.
 */

import { AuthorizationError } from '../auth/authorize.js'

/**
 * Shape returned by tool handlers on failure. The MCP SDK renders this as
 * a tool result with `isError: true`.
 */
export interface McpToolError {
  isError: true
  content: Array<{ type: 'text'; text: string }>
}

/**
 * Build an MCP error result from an arbitrary thrown value.
 */
export function toMcpToolError(err: unknown): McpToolError {
  const message = classifyError(err)
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  }
}

/**
 * Produce a human-readable message from a thrown error.
 * Preserves domain-specific messages for AuthorizationError and Error;
 * falls back to stringification for anything else.
 */
export function classifyError(err: unknown): string {
  if (err instanceof AuthorizationError) {
    return `Forbidden: ${err.message}`
  }
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}

/**
 * Wrap a tool handler so that thrown errors become MCP error results
 * instead of crashing the transport.
 */
export function safeTool<TArgs, TResult extends { isError?: boolean }>(
  fn: (args: TArgs) => Promise<TResult> | TResult,
): (args: TArgs) => Promise<TResult | McpToolError> {
  return async (args) => {
    try {
      return await fn(args)
    } catch (err) {
      return toMcpToolError(err)
    }
  }
}
