/**
 * guards.ts — per-transition guard checks.
 * All functions are pure (no I/O), receive typed inputs, return a string error or null.
 * Null = guard passes.
 */

import type { TaskState } from './statemachine.js'

// ---------------------------------------------------------------------------
// Shared types (minimal — only what the guards need)
// ---------------------------------------------------------------------------

export interface GitRef {
  repo: string
  base_sha: string
  head_sha: string
}

export interface Comment {
  kind: string          // 'narrative' | 'verdict' | 'review' | 'note'
  verdict?: string | null  // 'PASS' | 'REJECT' | null
}

export interface Evidence {
  manifest_json: string  // JSON string; checksum stored as sha256 of this string
  checksum: string       // sha256 of manifest_json at submission time
}

// ---------------------------------------------------------------------------
// Guard: →IMPLEMENTED
// Every gitref for this task must have head_sha !== base_sha,
// OR the task has allow_no_code_change set.
// Multi-repo: ALL gitrefs are checked (§10 TASK_HUB_DESIGN.md).
// ---------------------------------------------------------------------------

export function guardImplemented(
  gitrefs: GitRef[],
  allow_no_code_change: boolean,
): string | null {
  if (allow_no_code_change) return null
  if (gitrefs.length === 0) {
    return '->IMPLEMENTED requires at least one gitref with head_sha != base_sha, or allow_no_code_change'
  }
  const unchanged = gitrefs.filter(r => r.head_sha === r.base_sha || !r.head_sha)
  if (unchanged.length > 0) {
    const repos = unchanged.map(r => r.repo).join(', ')
    return `->IMPLEMENTED: repos have head_sha == base_sha (no commit): ${repos}. Set allow_no_code_change to bypass.`
  }
  return null
}

// ---------------------------------------------------------------------------
// Guard: →JUDGE_PASSED / →JUDGE_REJECTED
// A comment with kind='verdict' and the matching verdict value must exist.
//
// Scope: this verdict requirement only governs the JUDGE's own edges out of
// SELF_CHECK_PASSED. The human review-stage reject edges (TASK-063:
// JUDGE_PASSED/READY_TO_REVIEW → JUDGE_REJECTED) carry no judge verdict comment,
// so the guard is a no-op for them — without weakening the judge edge.
// ---------------------------------------------------------------------------

export function guardVerdict(
  from: TaskState,
  to: TaskState,
  comments: Comment[],
): string | null {
  if (from !== 'SELF_CHECK_PASSED') return null
  if (to !== 'JUDGE_PASSED' && to !== 'JUDGE_REJECTED') return null
  const expectedVerdict = to === 'JUDGE_PASSED' ? 'PASS' : 'REJECT'
  const found = comments.some(c => c.kind === 'verdict' && c.verdict === expectedVerdict)
  if (!found) {
    return `->${to} requires a comment with kind='verdict' and verdict='${expectedVerdict}'`
  }
  return null
}

// ---------------------------------------------------------------------------
// Guard: checksum re-verification for →JUDGE_PASSED and self-check transitions
// Ensures the manifest_json has not been tampered since submission.
// ---------------------------------------------------------------------------

export function guardChecksum(
  evidence: Evidence | null,
  computeChecksum: (data: string) => string,
): string | null {
  if (!evidence) {
    return 'Evidence is required for this transition but none was found'
  }
  const actual = computeChecksum(evidence.manifest_json)
  if (actual !== evidence.checksum) {
    return `Evidence checksum mismatch: expected ${evidence.checksum}, got ${actual}`
  }
  return null
}
