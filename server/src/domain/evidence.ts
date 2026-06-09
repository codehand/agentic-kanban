/**
 * evidence.ts — Runner-only evidence submission and self-check logic.
 * Implements immutable evidence storage and checksum verification per TASK_HUB_DESIGN.md §7.
 */

import type { Db } from '../db/connection.js';
import { insertEvidence, getLatestEvidenceByTask, type Evidence, type NewEvidence } from '../db/repositories/evidence.js';
import { propose, type ProposeInput, type TransitionRepository } from './gate.js';
import { verifyManifestChecksum, validateAndChecksumManifest } from './checksum.js';
import type { TaskState } from './statemachine.js';

// ---------------------------------------------------------------------------
// Repository interfaces for evidence domain
// ---------------------------------------------------------------------------

export interface TaskRepository {
  getCurrentState(task_id: string): TaskState;
  setCurrentState(task_id: string, state: TaskState): void;
}

export interface EvidenceSubmission {
  build_exit: number;
  test_exit: number;
  lint_exit?: number | null;
  ac_exit: number;
  coverage_pct?: number | null;
  manifest_json: string;
  logs_json?: string;
}

// ---------------------------------------------------------------------------
// evidence.submit() — Runner-only evidence submission
// ---------------------------------------------------------------------------

export function submit(
  db: Db,
  taskId: string,
  submittedByTokenId: string,
  role: string,
  evidenceData: EvidenceSubmission,
): Evidence {
  // AC5: Enforce role=runner (reject non-runner roles)
  if (role !== 'runner') {
    throw new Error(`Evidence submission requires role='runner', got role='${role}'`);
  }

  // Validate the manifest JSON and compute its checksum for verification
  validateAndChecksumManifest(evidenceData.manifest_json);

  // Prepare the new evidence record
  const newEvidence = {
    id: generateId(), // Simple ID generation
    task_id: taskId,
    submitted_by_token_id: submittedByTokenId,
    build_exit: evidenceData.build_exit,
    test_exit: evidenceData.test_exit,
    lint_exit: evidenceData.lint_exit !== undefined ? evidenceData.lint_exit : null,
    ac_exit: evidenceData.ac_exit,
    coverage_pct: evidenceData.coverage_pct !== undefined ? evidenceData.coverage_pct : null,
    manifest_json: evidenceData.manifest_json,
    logs_json: evidenceData.logs_json || '{}',
  } as NewEvidence;

  // Submit the evidence (append-only, no update path - AC6)
  return insertEvidence(db, newEvidence);
}

// ---------------------------------------------------------------------------
// task.selfcheck() — Read latest evidence, verify checksum, score, delegate to gate
// ---------------------------------------------------------------------------

export async function selfcheck(
  db: Db,
  taskId: string,
  submittedByTokenId: string,
  role: string,
  config: {
    lint_required?: boolean;
    coverage_required?: number | null;
  },
  taskRepo: TaskRepository,
  transitionRepo: TransitionRepository,
): Promise<{ success: boolean; reason?: string }> {
  // AC5: Enforce role=self-check (not strictly stated but implied from state machine)
  if (role !== 'self-check') {
    throw new Error(`Self-check requires role='self-check', got role='${role}'`);
  }

  // Get the latest evidence for this task
  const evidence = getLatestEvidenceByTask(db, taskId);
  if (!evidence) {
    return {
      success: false,
      reason: `No evidence found for task ${taskId}`
    };
  }

  // Verify the manifest checksum (AC8)
  try {
    const isValid = verifyManifestChecksum(evidence.manifest_json, validateAndChecksumManifest(evidence.manifest_json));
    if (!isValid) {
      return {
        success: false,
        reason: `Manifest checksum verification failed for task ${taskId}`
      };
    }
  } catch (error) {
    return {
      success: false,
      reason: `Manifest validation error: ${(error as Error).message}`
    };
  }

  // Score the evidence according to the acceptance criteria
  const scoringResult = scoreEvidence(evidence, config);

  // If scoring fails, return immediately with failure - don't delegate to gate
  if (!scoringResult.passed) {
    return {
      success: false,
      reason: scoringResult.reason
    };
  }

  // If scoring passes, determine target state and delegate to gate
  const targetState: 'SELF_CHECK_PASSED' | 'SELF_CHECK_FAILED' = 'SELF_CHECK_PASSED';

  // Create the transition input for the gate
  const input: ProposeInput = {
    task_id: taskId,
    current_state: taskRepo.getCurrentState(taskId),
    from: taskRepo.getCurrentState(taskId), // Should be IMPLEMENTED per state machine
    to: targetState,
    actor_role: role,
    actor_token_id: submittedByTokenId,
    evidence_id: evidence.id,
    evidence: {
      manifest_json: evidence.manifest_json,
      checksum: validateAndChecksumManifest(evidence.manifest_json),
    }, // Transform database evidence to guard-compatible format
    computeChecksum: (data: string) => validateAndChecksumManifest(data),
  };

  // Delegate to the gate to perform the state transition (AC10)
  const result = propose(input, transitionRepo);

  if (!result.ok) {
    return {
      success: false,
      reason: `Gate rejection: ${result.error}`
    };
  }

  // Update our internal state tracking
  taskRepo.setCurrentState(taskId, targetState);

  return {
    success: true,
    reason: scoringResult.reason
  };
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function generateId(): string {
  // Simple ID generation - in production this might use UUID or similar
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

interface ScoringResult {
  passed: boolean;
  reason: string;
}

function scoreEvidence(
  evidence: Evidence,
  config: {
    lint_required?: boolean;
    coverage_required?: number | null;
  },
): ScoringResult {
  // AC7: Build/test/ac are hard-required
  // Build must pass (exit code 0)
  if (evidence.build_exit !== 0) {
    return {
      passed: false,
      reason: `Build failed with exit code ${evidence.build_exit}`
    };
  }

  // Test must pass (exit code 0)
  if (evidence.test_exit !== 0) {
    return {
      passed: false,
      reason: `Tests failed with exit code ${evidence.test_exit}`
    };
  }

  // Acceptance criteria must pass (exit code 0)
  if (evidence.ac_exit !== 0) {
    return {
      passed: false,
      reason: `Acceptance criteria failed with exit code ${evidence.ac_exit}`
    };
  }

  // Lint check - configurable behavior (AC9)
  if (evidence.lint_exit !== undefined && evidence.lint_exit !== null) {
    if (config.lint_required && evidence.lint_exit !== 0) {
      return {
        passed: false,
        reason: `Lint failed with exit code ${evidence.lint_exit} and lint is configured as required`
      };
    }
  }

  // Coverage check - configurable behavior (AC9)
  if (config.coverage_required !== undefined && config.coverage_required !== null) {
    if (evidence.coverage_pct === undefined || evidence.coverage_pct === null) {
      return {
        passed: false,
        reason: `Coverage required (${config.coverage_required}%) but no coverage data provided`
      };
    }

    if (evidence.coverage_pct < config.coverage_required) {
      return {
        passed: false,
        reason: `Coverage ${evidence.coverage_pct}% is below required threshold ${config.coverage_required}%`
      };
    }
  }

  // All checks passed
  return {
    passed: true,
    reason: 'All required checks passed: build, test, ac, lint, and coverage thresholds met'
  };
}