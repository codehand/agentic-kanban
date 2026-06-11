/**
 * Role -> permission mapping per TASK_HUB_DESIGN.md §3.
 *
 * Roles: human | implementer | self-check | judge | runner
 *
 * Permissions defined by the design table:
 *   human       : approve→DONE, reset/remove, mint/revoke token, read-all
 *   implementer : claim task, TODO→IN_PROGRESS→IMPLEMENTED, comment narrative, set gitref
 *   self-check  : trigger evidence run, IMPLEMENTED→SELF_CHECK_*, (no code changes)
 *   judge       : SELF_CHECK_PASSED→JUDGE_*, comment verdict
 *   runner      : evidence.submit ONLY — no transition, no comment
 */

export type Role = 'human' | 'implementer' | 'self-check' | 'judge' | 'runner';

export type Action =
  // Transitions
  | 'task.transition.todo_to_in_progress'
  | 'task.transition.in_progress_to_implemented'
  | 'task.transition.self_check'      // IMPLEMENTED -> SELF_CHECK_*
  | 'task.transition.judge'           // SELF_CHECK_PASSED -> JUDGE_*
  | 'task.transition.approve'         // JUDGE_PASSED -> DONE
  | 'task.transition.rework'          // *_FAILED/*_REJECTED -> IN_PROGRESS
  // Token management
  | 'token.mint'
  | 'token.revoke'
  // Evidence
  | 'evidence.submit'
  // Comments
  | 'comment.narrative'
  | 'comment.verdict'
  | 'comment.review'
  // Task mgmt
  | 'task.claim'
  | 'task.create'
  | 'task.update'
  | 'task.reset'
  | 'task.remove'
  | 'gitref.set'
  // Read
  | 'read';

const PERMISSIONS: Record<Role, Set<Action>> = {
  human: new Set<Action>([
    'task.transition.approve',
    'task.reset',
    'task.remove',
    'task.create',
    'task.update',
    'token.mint',
    'token.revoke',
    'comment.review',
    'read',
    // human can also perform rework (reset)
    'task.transition.rework',
  ]),
  implementer: new Set<Action>([
    'task.claim',
    'task.transition.todo_to_in_progress',
    'task.transition.in_progress_to_implemented',
    'task.transition.rework',
    'task.update',
    'comment.narrative',
    'gitref.set',
    'read',
  ]),
  'self-check': new Set<Action>([
    'task.transition.self_check',
    'comment.narrative',
    'read',
  ]),
  judge: new Set<Action>([
    'task.transition.judge',
    'comment.verdict',
    'read',
  ]),
  runner: new Set<Action>([
    'evidence.submit',
    'read',
  ]),
};

/**
 * Returns true if `role` is permitted to perform `action`.
 * Server MUST call this before executing any state-changing tool/route.
 */
export function authorize(role: Role, action: Action): boolean {
  const allowed = PERMISSIONS[role];
  if (!allowed) return false;
  return allowed.has(action);
}

/**
 * Asserts authorization; throws a structured error on failure.
 * Use in handlers that want to throw rather than return boolean.
 */
export function assertAuthorized(role: Role, action: Action): void {
  if (!authorize(role, action)) {
    throw new AuthorizationError(role, action);
  }
}

export class AuthorizationError extends Error {
  constructor(public readonly role: Role, public readonly action: Action) {
    super(`Role '${role}' is not permitted to perform '${action}'`);
    this.name = 'AuthorizationError';
  }
}
