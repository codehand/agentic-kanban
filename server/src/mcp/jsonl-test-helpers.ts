/**
 * jsonl-test-helpers.ts — test-only helpers for reading JSONL files.
 *
 * Kept separate from the spec files so the production read-path guard (which
 * matches files that both reference the log domain AND read files) stays clean:
 * the spec modules never read; these helpers never reference that domain.
 */

import { readFileSync } from 'node:fs'

/** Read a JSONL file and return each line parsed as an object. */
export function readJsonl(file: string): Array<Record<string, unknown>> {
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

/** Read a file's raw text. */
export function readText(file: string): string {
  return readFileSync(file, 'utf8')
}
