/**
 * checksum.ts — verify manifest checksums to ensure evidence integrity.
 * Per TASK_HUB_DESIGN.md §7: detect tampering of evidence after submission.
 */

import { createHash } from 'node:crypto';

/**
 * Verifies that a manifest JSON string matches the expected checksum.
 * @param manifestJson The JSON string representing the manifest
 * @param expectedChecksum The expected SHA-256 checksum
 * @returns true if checksum matches, false otherwise
 */
export function verifyManifestChecksum(manifestJson: string, expectedChecksum: string): boolean {
  const actualChecksum = computeSha256(manifestJson);
  return actualChecksum === expectedChecksum;
}

/**
 * Computes the SHA-256 checksum of a string.
 * @param data The input string to hash
 * @returns The SHA-256 checksum as hex string
 */
export function computeSha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Validates that a manifest JSON string is well-formed and computes its checksum.
 * @param manifestJson The manifest JSON string
 * @returns The computed checksum if valid, throws if malformed
 */
export function validateAndChecksumManifest(manifestJson: string): string {
  try {
    // Verify that the manifest is valid JSON by parsing and re-stringifying
    JSON.parse(manifestJson);
    return computeSha256(manifestJson);
  } catch (error) {
    throw new Error(`Invalid manifest JSON: ${(error as Error).message}`);
  }
}