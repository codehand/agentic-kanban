/**
 * evidence.test.ts - Tests for the evidence subsystem (TASK-006).
 * Verifies: AC5 (role enforcement), AC6 (immutable/appending), AC7 (scoring),
 * AC8 (checksum verification), AC9 (lint/coverage config), AC10 (delegates to gate).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { submit, selfcheck } from '../src/domain/evidence.js';
import { verifyManifestChecksum, computeSha256 } from '../src/domain/checksum.js';
import { openMemoryDb, type Db } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { listEvidenceByTask } from '../src/db/repositories/evidence.js';
import type { TaskState } from '../domain/statemachine.js';

// Mock repositories
interface MockTaskRepo {
  stateMap: Map<string, TaskState>;
  getCurrentState(task_id: string): TaskState;
  setCurrentState(task_id: string, state: TaskState): void;
}

interface MockTransitionRecord {
  task_id: string;
  from_state: string;
  to_state: string;
  actor_role: string;
  [k: string]: unknown;
}

interface MockTransitionRepo {
  transitions: Array<MockTransitionRecord>;
  append(record: MockTransitionRecord): void;
  setTaskState(task_id: string, state: TaskState): void;
}

describe('Evidence Subsystem', () => {
  let db: Db;
  let mockTaskRepo: MockTaskRepo;
  let mockTransitionRepo: MockTransitionRepo;

  beforeEach(() => {
    // Create a fresh in-memory database for each test
    db = openMemoryDb();
    runMigrations(db);

    // Create a test project and task first
    db.prepare(`INSERT INTO project (id, slug, name) VALUES ('proj-1', 'test-project', 'Test Project')`).run();
    db.prepare(`INSERT INTO task (id, project_id, key, title, state) VALUES ('task-1', 'proj-1', 'TASK-001', 'Test Task', 'IMPLEMENTED')`).run();

    // Initialize mock task repository
    mockTaskRepo = {
      stateMap: new Map([['task-1', 'IMPLEMENTED']]), // Default to IMPLEMENTED as per state machine
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
      append(record: MockTransitionRecord) {
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
          db,
          'task-1',
          'token-1',
          'implementer', // Wrong role
          { build_exit: 0, test_exit: 0, ac_exit: 0, manifest_json: '{}' }
        )
      ).toThrow("Evidence submission requires role='runner', got role='implementer'");

      expect(() =>
        submit(
          db,
          'task-1',
          'token-1',
          'runner', // Correct role
          { build_exit: 0, test_exit: 0, ac_exit: 0, manifest_json: '{}' }
        )
      ).not.toThrow();
    });

    it('AC6: creates new evidence row (append-only)', () => {
      const evidence1 = submit(
        db,
        'task-1',
        'token-1',
        'runner',
        { build_exit: 0, test_exit: 0, ac_exit: 0, manifest_json: '{}' }
      );

      const evidence2 = submit(
        db,
        'task-1',
        'token-1',
        'runner',
        { build_exit: 1, test_exit: 0, ac_exit: 0, manifest_json: '{}' }
      );

      // Should have two separate evidence records
      const allEvidence = listEvidenceByTask(db, 'task-1');
      expect(allEvidence.length).toBe(2);
      expect(evidence1.id).not.toBe(evidence2.id);
      expect(evidence1.build_exit).toBe(0);
      expect(evidence2.build_exit).toBe(1);

      // Verify the first evidence is unchanged
      const retrievedEvidence1 = allEvidence.find(e => e.id === evidence1.id);
      expect(retrievedEvidence1?.build_exit).toBe(0); // Should remain unchanged
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
        db,
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
        db,
        'task-1',
        'token-1',
        'self-check',
        {},
        mockTaskRepo,
        mockTransitionRepo
      );

      expect(result.success).toBe(true);
      expect(mockTransitionRepo.transitions.length).toBe(1);
      expect(mockTransitionRepo.transitions[0].to_state).toBe('SELF_CHECK_PASSED');
    });

    it('AC7: fails when build fails', async () => {
      submit(
        db,
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
        db,
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
        db,
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
        db,
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
        db,
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
        db,
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
        db,
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

      // Reset task state to IMPLEMENTED before first selfcheck
      mockTaskRepo.setCurrentState('task-1', 'IMPLEMENTED');

      // Without lint_required flag, should pass despite lint failure
      const result1 = await selfcheck(
        db,
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

      // Create a fresh evidence record for the second test
      submit(
        db,
        'task-1',
        'token-1',
        'runner',
        {
          build_exit: 0,
          test_exit: 0,
          ac_exit: 0,
          lint_exit: 1,  // Lint failed
          manifest_json: '{"file1": "abc123"}'
        }
      );

      // Reset task state again to IMPLEMENTED before second selfcheck
      mockTaskRepo.setCurrentState('task-1', 'IMPLEMENTED');

      // With lint_required: true, should fail due to lint failure
      const result2 = await selfcheck(
        db,
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
        db,
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

      // Reset task state to IMPLEMENTED before selfcheck
      mockTaskRepo.setCurrentState('task-1', 'IMPLEMENTED');

      // With required coverage above actual, should fail
      const result = await selfcheck(
        db,
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
        db,
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
        db,
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
      expect(transition.to_state).toBe('SELF_CHECK_PASSED');
      expect(transition.actor_role).toBe('self-check');
    });

    it('AC5: enforces role=self-check', async () => {
      submit(
        db,
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
          db,
          'task-1',
          'token-1',
          'implementer', // Wrong role
          {},
          mockTaskRepo,
          mockTransitionRepo
        );
      }).rejects.toThrow("Self-check requires role='self-check', got role='implementer'");
    });

    it('TASK-014: rejects tampered manifest stored in DB', async () => {
      // Submit legitimate evidence — this stores the manifest and its checksum.
      const ev = submit(
        db,
        'task-1',
        'token-1',
        'runner',
        {
          build_exit: 0,
          test_exit: 0,
          ac_exit: 0,
          manifest_json: '{"file1": "original_hash"}'
        }
      );

      // Sanity: selfcheck should pass before tampering.
      const before = await selfcheck(
        db,
        'task-1',
        'token-1',
        'self-check',
        {},
        mockTaskRepo,
        mockTransitionRepo
      );
      expect(before.success).toBe(true);

      // Reset state for the post-tamper selfcheck.
      mockTaskRepo.setCurrentState('task-1', 'IMPLEMENTED');
      mockTransitionRepo.transitions = [];

      // Simulate an attacker modifying the manifest_json in the DB after
      // submission. We drop the append-only trigger temporarily to perform
      // the UPDATE — in production this would be a direct SQLite attack.
      db.exec('DROP TRIGGER IF EXISTS trg_evidence_no_update');
      db.prepare('UPDATE evidence SET manifest_json = ? WHERE id = ?')
        .run('{"file1": "tampered_hash"}', ev.id);
      db.exec(`
        CREATE TRIGGER trg_evidence_no_update
        BEFORE UPDATE ON evidence
        BEGIN
          SELECT RAISE(ABORT, 'evidence is append-only: UPDATE not allowed');
        END
      `);

      // selfcheck must now REJECT because the stored checksum (of the original
      // manifest) no longer matches the tampered manifest read back from DB.
      const after = await selfcheck(
        db,
        'task-1',
        'token-1',
        'self-check',
        {},
        mockTaskRepo,
        mockTransitionRepo
      );

      expect(after.success).toBe(false);
      expect(after.reason).toContain('checksum verification failed');
      expect(mockTransitionRepo.transitions.length).toBe(0);
    });
  });
});