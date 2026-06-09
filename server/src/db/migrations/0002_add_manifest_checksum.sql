-- Migration 0002: add manifest_checksum to evidence
-- Stores the SHA-256 checksum of manifest_json at submission time.
-- This enables tamper detection: selfcheck compares this stored checksum
-- against a freshly computed checksum of the manifest read back from DB.
-- Without this column, the system computed the checksum from the very
-- manifest it was verifying — a tautology that could never detect tampering.

ALTER TABLE evidence ADD COLUMN manifest_checksum TEXT NOT NULL DEFAULT '';
