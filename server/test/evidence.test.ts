/**
 * evidence.test.ts - Tests for the evidence subsystem (TASK-006).
 * Verifies: AC5 (role enforcement), AC6 (immutable/appending), AC7 (scoring),
 * AC8 (checksum verification), AC9 (lint/coverage config), AC10 (delegates to gate).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submit, selfcheck } from '../src/domain/evidence.js';
import { verifyManifestChecksum, computeSha256 } from '../src/domain/checksum.js';
import type { Db } from 'better-sqlite3';
import { type Evidence, getLatestEvidenceByTask, insertEvidence, listEvidenceByTask } from '../src/db/repositories/evidence.js';
import { type TaskState } from '../src/domain/statemachine.js';
import type { ProposeInput } from '../src/domain/gate.js';

// Mock repositories
interface MockTaskRepo {
  stateMap: Map<string, TaskState>;
  getCurrentState(task_id: string): TaskState;
  setCurrentState(task_id: string, state: TaskState): void;
}

interface MockTransitionRepo {
  transitions: Array<any>;
  append(record: any): void;
  setTaskState(task_id: string, state: TaskState): void;
}

// Mock DB for better-sqlite3 interface
interface MockStatement {
  run: (...params: any[]) => any;
  get: (...params: any[]) => any;
  all: (...params: any[]) => any;
}

interface MockDB {
  prepare: (sql: string) => MockStatement;
  evidences: Array<Evidence>;
  statementMocks: Map<string, MockStatement>;
}

describe('Evidence Subsystem', () => {
  let mockDb: MockDB;
  let mockTaskRepo: MockTaskRepo;
  let mockTransitionRepo: MockTransitionRepo;

  beforeEach(() => {
    const evidences: Evidence[] = [];

    // Create statement mocks for different SQL queries
    const statementMocks = new Map<string, MockStatement>();

    // INSERT INTO evidence statement mock
    statementMocks.set('INSERT INTO evidence', {
      run: (id: string, task_id: string, submitted_by_token_id: string,
            build_exit: number, test_exit: number, lint_exit: number | null,
            ac_exit: number, coverage_pct: number | null,
            manifest_json: string, logs_json: string) => {
        const evidence: Evidence = {
          id,
          task_id,
          submitted_by_token_id,
          build_exit,
          test_exit,
          lint_exit,
          ac_exit,
          coverage_pct,
          manifest_json,
          logs_json,
          created_at: new Date().toISOString()
        };
        evidences.push(evidence);
        return { lastInsertRowid: evidences.length }; // Simulate insert result
      }
    });

    // SELECT * FROM evidence WHERE id = ? statement mock
    statementMocks.set('SELECT * FROM evidence WHERE id =', {
      get: (id: string) => evidences.find(e => e.id === id)
    });

    // SELECT * FROM evidence WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1 statement mock
    statementMocks.set('SELECT * FROM evidence WHERE task_id =', {
      get: (taskId: string) => {
        const taskEvidences = evidences.filter(e => e.task_id === taskId);
        if (taskEvidences.length === 0) return undefined;

        // Sort by created_at DESC (latest first), with a simulated rowid for tie-breaking
        return [...taskEvidences].sort((a, b) => {
          if (a.created_at !== b.created_at) {
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          }
          // Using id as tie-breaker for simplicity in test
          return b.id.localeCompare(a.id);
        })[0];
      }
    });

    // SELECT * FROM evidence WHERE task_id = ? ORDER BY created_at ASC statement mock
    statementMocks.set('SELECT * FROM evidence WHERE task_id = ? ORDER BY created_at ASC', {
      all: (taskId: string) => evidences.filter(e => e.task_id === taskId)
    });

    mockDb = {
      evidences,
      statementMocks,
      prepare: (sql: string) => {
        // Find the appropriate mock by looking for the beginning of the SQL
        for (const [key, stmt] of statementMocks.entries()) {
          if (sql.startsWith(key)) {
            return stmt;
          }
        }

        // Default fallback
        return {
          run: () => {},
          get: () => undefined,
          all: () => []
        };
      }
    };

    // Initialize mock task repository
    mockTaskRepo = {
      stateMap: new Map(),
      getCurrentState(task_id: string): TaskState {
        return this.stateMap.get(task_id) ?? 'IMPLEMENTED';
      },
      setCurrentState(task_id: string, state: TaskState) {
        this.stateMap.set(task_id, state);
      }
    };

    // Initialize mock transition repository
    mockTransitionRepo = {
      transitions: [],
      append(record: any) {
        this.transitions.push(record);
      },
      setTaskState(task_id: string, state: TaskState) {
        mockTaskRepo.setCurrentState(task_id, state);
      }
    };
  });

  describe('submit', () => {
    it('AC5: enforces role=runner', () => {
      expect(() =>
        submit(
          mockDb as unknown as Db,
          'task-1',
          'token-1',
          'implementer', // Wrong role
          { build_exit: 0, test_exit: 0, ac_exit: 0, manifest_json: '{}' }
        )
      ).toThrow("Evidence submission requires role='runner', got role='implementer'");

      // Mock the necessary DB operations for the successful case
      const originalPrepare = mockDb.prepare;
      mockDb.prepare = (sql: string) => {
        if (sql.startsWith('INSERT INTO evidence')) {
          return {
            run: (id: string, task_id: string, submitted_by_token_id: string,
                  build_exit: number, test_exit: number, lint_exit: number | null,
                  ac_exit: number, coverage_pct: number | null,
                  manifest_json: string, logs_json: string) => {
              const evidence: Evidence = {
                id,
                task_id,
                submitted_by_token_id,
                build_exit,
                test_exit,
                lint_exit,
                ac_exit,
                coverage_pct,
                manifest_json,
                logs_json,
                created_at: new Date().toISOString()
              };
              mockDb.evidences.push(evidence);
              return { lastInsertRowid: mockDb.evidences.length };
            }
          };
        } else if (sql.startsWith('SELECT * FROM evidence WHERE id =')) {
          return {
            get: (id: string) => mockDb.evidences.find(e => e.id === id)
          };
        }
        return originalPrepare.call(mockDb, sql);
      };

      expect(() =>
        submit(
          mockDb as unknown as Db,
          'task-1',
          'token-1',
          'runner', // Correct role
          { build_exit: 0, test_exit: 0, ac_exit: 0, manifest_json: '{}' }
        )
      ).not.toThrow();
    });

    it('AC6: creates new evidence row (append-only)', () => {
      const evidence1 = submit(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'runner',
        { build_exit: 0, test_exit: 0, ac_exit: 0, manifest_json: '{}' }
      );

      const evidence2 = submit(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'runner',
        { build_exit: 1, test_exit: 0, ac_exit: 0, manifest_json: '{}' }
      );

      // Should have two separate evidence records
      expect(mockDb.evidences.length).toBe(2);
      expect(evidence1.id).not.toBe(evidence2.id);
      expect(evidence1.build_exit).toBe(0);
      expect(evidence2.build_exit).toBe(1);
    });
  });

  describe('checksum', () => {
    it('AC8: verifies manifest checksum correctly', () => {
      const manifest = '{"file1": "abc123"}';
      const checksum = computeSha256(manifest);

      expect(verifyManifestChecksum(manifest, checksum)).toBe(true);

      // Tampered manifest should fail
      expect(verifyManifestChecksum('{"file1": "xyz789"}', checksum)).toBe(false);
    });
  });

  describe('selfcheck', () => {
    it('AC7: passes when build/test/ac succeed', async () => {
      // First submit some evidence
      submit(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'runner',
        {
          build_exit: 0,
          test_exit: 0,
          ac_exit: 0,
          manifest_json: '{"file1": "abc123"}'
        }
      );

      const result = await selfcheck(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'self-check',
        {},
        mockTaskRepo,
        mockTransitionRepo
      );

      expect(result.success).toBe(true);
      expect(mockTransitionRepo.transitions.length).toBe(1);
      expect(mockTransitionRepo.transitions[0].to).toBe('SELF_CHECK_PASSED');
    });

    it('AC7: fails when build fails', async () => {
      submit(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'runner',
        {
          build_exit: 1,  // Failed build
          test_exit: 0,
          ac_exit: 0,
          manifest_json: '{"file1": "abc123"}'
        }
      );

      const result = await selfcheck(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'self-check',
        {},
        mockTaskRepo,
        mockTransitionRepo
      );

      expect(result.success).toBe(false);
      expect(result.reason).toContain('Build failed');
    });

    it('AC7: fails when test fails', async () => {
      submit(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'runner',
        {
          build_exit: 0,
          test_exit: 1,  // Failed tests
          ac_exit: 0,
          manifest_json: '{"file1": "abc123"}'
        }
      );

      const result = await selfcheck(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'self-check',
        {},
        mockTaskRepo,
        mockTransitionRepo
      );

      expect(result.success).toBe(false);
      expect(result.reason).toContain('Tests failed');
    });

    it('AC7: fails when ac fails', async () => {
      submit(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'runner',
        {
          build_exit: 0,
          test_exit: 0,
          ac_exit: 1,  // Failed AC
          manifest_json: '{"file1": "abc123"}'
        }
      );

      const result = await selfcheck(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'self-check',
        {},
        mockTaskRepo,
        mockTransitionRepo
      );

      expect(result.success).toBe(false);
      expect(result.reason).toContain('Acceptance criteria failed');
    });

    it('AC9: handles optional lint (pass/fail should not block)', async () => {
      submit(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'runner',
        {
          build_exit: 0,
          test_exit: 0,
          ac_exit: 0,
          lint_exit: 1,  // Lint failed, but not required
          manifest_json: '{"file1": "abc123"}'
        }
      );

      // Without lint_required flag, should pass despite lint failure
      const result1 = await selfcheck(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'self-check',
        {},  // No lint requirement
        mockTaskRepo,
        mockTransitionRepo
      );

      expect(result1.success).toBe(true);

      // Clear transitions for next test
      mockTransitionRepo.transitions = [];

      // With lint_required: true, should fail due to lint failure
      const result2 = await selfcheck(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'self-check',
        { lint_required: true },  // Lint required
        mockTaskRepo,
        mockTransitionRepo
      );

      expect(result2.success).toBe(false);
      expect(result2.reason).toContain('Lint failed');
    });

    it('AC9: handles coverage requirements', async () => {
      submit(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'runner',
        {
          build_exit: 0,
          test_exit: 0,
          ac_exit: 0,
          coverage_pct: 75,  // Below threshold
          manifest_json: '{"file1": "abc123"}'
        }
      );

      // With required coverage above actual, should fail
      const result = await selfcheck(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'self-check',
        { coverage_required: 80 },  // 80% required, only got 75%
        mockTaskRepo,
        mockTransitionRepo
      );

      expect(result.success).toBe(false);
      expect(result.reason).toContain('Coverage 75% is below required threshold 80%');
    });

    it('AC10: delegates state change to gate', async () => {
      submit(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'runner',
        {
          build_exit: 0,
          test_exit: 0,
          ac_exit: 0,
          manifest_json: '{"file1": "abc123"}'
        }
      );

      const result = await selfcheck(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'self-check',
        {},
        mockTaskRepo,
        mockTransitionRepo
      );

      expect(result.success).toBe(true);
      expect(mockTransitionRepo.transitions.length).toBe(1);
      const transition = mockTransitionRepo.transitions[0];
      expect(transition.to).toBe('SELF_CHECK_PASSED');
      expect(transition.actor_role).toBe('self-check');
    });

    it('AC5: enforces role=self-check', async () => {
      submit(
        mockDb as unknown as Db,
        'task-1',
        'token-1',
        'runner',
        {
          build_exit: 0,
          test_exit: 0,
          ac_exit: 0,
          manifest_json: '{"file1": "abc123"}'
        }
      );

      await expect(async () => {
        await selfcheck(
          mockDb as unknown as Db,
          'task-1',
          'token-1',
          'implementer', // Wrong role
          {},
          mockTaskRepo,
          mockTransitionRepo
        );
      }).rejects.toThrow("Self-check requires role='self-check', got role='implementer'");
    });
  });
});