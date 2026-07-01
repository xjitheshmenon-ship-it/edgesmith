-- Rule Book §15 (soft delete): nothing is ever hard-deleted. Removing a skill
-- certification from an employee must archive the record, not DELETE it, so the
-- certification history is preserved. Adds a revocation timestamp; a NULL
-- revoked_at means the badge is currently held.

ALTER TABLE employee_badges ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
