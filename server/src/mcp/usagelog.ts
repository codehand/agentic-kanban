/**
 * mcp/usagelog.ts — append-only JSONL telemetry of every MCP tool call.
 *
 * Per TASK-028: write-only, fire-and-forget. logToolCall() appends one JSON
 * line to <USAGE_LOG_DIR>/usage-YYYY-MM-DD.jsonl (daily file, UTC). Every write
 * is wrapped in try/catch that swallows errors so logging can NEVER affect a
 * tool call's result. There is no read path in server/src — developers query
 * the files manually (tail/jq/grep).
 *
 * SECURITY: only the identifying fields below are recorded. We never log the
 * bearer secret, secret_hash, or the full tool args (which may carry secrets or
 * large evidence manifests).
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** One telemetry line. Shape is the documented event schema (see docs). */
export interface UsageEvent {
  /** ISO 8601 timestamp of when the call completed. */
  ts: string
  /** MCP tool name, e.g. 'project.list'. */
  tool: string
  /** Caller role, e.g. 'implementer'. */
  role: string
  /** Caller token id (never the secret). */
  token_id: string
  /** Project slug/id derived from args, or null. */
  project: string | null
  /** Task key derived from args, or null. */
  task_key: string | null
  /** ok | rejected (domain/authz/validation) | error (system). */
  outcome: 'ok' | 'rejected' | 'error'
  /** Failure message, or null when outcome is ok. */
  error_message: string | null
  /** Wall-clock duration of the tool handler in milliseconds. */
  duration_ms: number
}

/** Resolve the configured usage log directory, or null when disabled. */
export function resolveUsageLogDir(value: string | undefined): string | null {
  const v = (value ?? 'logs/usage').trim()
  if (v === '' || v.toLowerCase() === 'off') return null
  return v
}

/**
 * Append one usage event to today's JSONL file. Fire-and-forget: returns a
 * resolved promise even on failure, never throws. Pass dir=null to disable.
 */
export async function logToolCall(dir: string | null, event: UsageEvent): Promise<void> {
  if (!dir) return
  try {
    const day = event.ts.slice(0, 10) // YYYY-MM-DD (UTC, from an ISO string)
    const file = join(dir, `usage-${day}.jsonl`)
    await mkdir(dir, { recursive: true })
    await appendFile(file, JSON.stringify(event) + '\n', 'utf8')
  } catch {
    // Swallow: usage logging must never break a tool call.
  }
}
