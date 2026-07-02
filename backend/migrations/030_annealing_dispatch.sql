-- ============================================================================
-- 030 — Annealing two-leg dispatch (external, UID-level)
--
-- A "very low" HRC piece cannot be recovered by re-tempering; it is sent to a
-- third-party annealing contractor and comes back to re-enter the cycle from
-- Hardening (HT70). Unlike the rolling dispatch (block-count + colour centric),
-- this is per-UID and returns to the SAME site — so it gets its own table.
-- ============================================================================

CREATE TABLE IF NOT EXISTS annealing_dispatches (
  id                 SERIAL PRIMARY KEY,
  reference          VARCHAR(40) UNIQUE NOT NULL,           -- 'DHR-ANN-2024-001'
  uid_id             BIGINT NOT NULL REFERENCES uids(id),
  contractor_id      INT REFERENCES contractors(id),
  dispatched_at      DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_return_date DATE,
  returned_at        DATE,
  status             VARCHAR(20) NOT NULL DEFAULT 'dispatched', -- dispatched | returned
  notes              TEXT,
  created_by         INT REFERENCES employees(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_annealing_uid ON annealing_dispatches(uid_id);
CREATE INDEX IF NOT EXISTS idx_annealing_status ON annealing_dispatches(status);
