-- ============================================================================
-- 038 — Job-level HOLD (rule book §6)
--
-- HOLD previously existed only on Dharmapuri UIDs, so a Faridabad weld job or a
-- furnace job (no uid_id) could not be held. Add hold to the job state machine
-- plus the attribution columns so a Supervisor/Admin can hold any job with a
-- mandatory reason and release it later. ('open' is added to the allowed states
-- too, for the OPEN step of the state machine.)
-- ============================================================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hold_reason TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hold_by     INT REFERENCES employees(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS held_at     TIMESTAMPTZ;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS chk_job_status;
ALTER TABLE jobs ADD  CONSTRAINT chk_job_status
  CHECK (status IN ('queued','open','in_progress','paused','hold','closed'));
