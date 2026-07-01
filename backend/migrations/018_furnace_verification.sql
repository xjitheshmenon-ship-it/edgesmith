-- Rule Book §8.3 — furnace batches require a two-step gate: an HT-certified
-- operator sets the batch up, then a Supervisor verifies it before the run may
-- start. These columns record the verifying supervisor and time; a batch stays
-- in status 'pending_verification' until verified, then becomes 'running'.

ALTER TABLE furnace_batches ADD COLUMN IF NOT EXISTS verified_by INT REFERENCES employees(id);
ALTER TABLE furnace_batches ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- Allow the new 'pending_verification' status alongside the existing values.
ALTER TABLE furnace_batches DROP CONSTRAINT IF EXISTS chk_furnace_status;
ALTER TABLE furnace_batches ADD CONSTRAINT chk_furnace_status
  CHECK (status IN ('loading', 'ready', 'pending_verification', 'running', 'complete'));
