/**
 * comment-action.ts — single source of truth for the comment-kind → required
 * Action mapping, shared by the MCP `comment.add` tool and the REST
 * `POST /api/tasks/:key/comments` route so the two surfaces can never drift.
 */
import type { Action } from './authorize.js'

/** Map a comment kind to the required authorization action. */
export function commentAction(kind: string): Action {
  switch (kind) {
    case 'narrative':
      return 'comment.narrative'
    case 'verdict':
      return 'comment.verdict'
    case 'review':
      return 'comment.review'
    default:
      return 'comment.narrative'
  }
}
