/**
 * mcp/context.ts — shared context passed to every tool handler.
 *
 * Tools need the database connection and the resolved auth token for the
 * current request. We bundle these into a single context object that the
 * tool registration layer closes over.
 */

import type { Db } from '../db/connection.js'
import type { ResolvedToken } from '../auth/resolve.js'

export interface McpContext {
  db: Db
  auth: ResolvedToken
}
