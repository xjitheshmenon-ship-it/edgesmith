-- ============================================================================
-- 033 — Quality Control dashboard: overrides, concession requests, instructions
--
-- The QC page becomes a live read-only dashboard with three admin/manager
-- capabilities that had no storage before:
--   1. qc_overrides       — an admin force-passing/failing a recorded result,
--                           with a mandatory reason. Kept as append-only history
--                           so a result can be counter-overridden (never edited).
--   2. concession_requests — a per-piece record raised when a dimension is below
--                           the finished-good minimum. A Manager/Admin approves
--                           (release the hold, box marked in the concession colour)
--                           or rejects (piece stays on hold).
--   3. alerts.acknowledged_at — Admin "instructions to the Supervisor" are
--                           delivered as targeted alerts; we already track WHO
--                           acknowledged (026), add WHEN so the log is complete.
-- ============================================================================

-- 1. QC result overrides (append-only history) ------------------------------
CREATE TABLE IF NOT EXISTS qc_overrides (
  id               BIGSERIAL PRIMARY KEY,
  uid_step_log_id  BIGINT REFERENCES uid_step_logs(id),
  uid_id           BIGINT REFERENCES uids(id),
  uid_code         VARCHAR(30),
  step_number      VARCHAR(5),
  original_result  VARCHAR(20),
  new_result       VARCHAR(20) NOT NULL,          -- Pass|Fail|Borderline
  reason           TEXT NOT NULL,
  overridden_by    INT REFERENCES employees(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_override_result CHECK (new_result IN ('Pass','Fail','Borderline')),
  CONSTRAINT chk_override_reason_len CHECK (char_length(reason) >= 20)
);
CREATE INDEX IF NOT EXISTS idx_qc_overrides_uid ON qc_overrides(uid_id);
CREATE INDEX IF NOT EXISTS idx_qc_overrides_created ON qc_overrides(created_at DESC);

-- 2. Per-piece concession requests ------------------------------------------
CREATE TABLE IF NOT EXISTS concession_requests (
  id               BIGSERIAL PRIMARY KEY,
  uid_id           BIGINT REFERENCES uids(id),
  uid_code         VARCHAR(30),
  uid_step_log_id  BIGINT REFERENCES uid_step_logs(id),
  step_number      VARCHAR(5),
  operation_name   VARCHAR(120),
  dimension        VARCHAR(20) NOT NULL,          -- width|thickness|both
  measured_value   NUMERIC(10,2),
  min_value        NUMERIC(10,2),
  concession_color_id INT REFERENCES concession_color_codes(id),
  status           VARCHAR(20) NOT NULL DEFAULT 'pending',   -- pending|approved|rejected
  raised_by        INT REFERENCES employees(id),
  decided_by       INT REFERENCES employees(id),
  decided_at       TIMESTAMPTZ,
  decision_note    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_concession_status CHECK (status IN ('pending','approved','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_concession_requests_status ON concession_requests(status);
CREATE INDEX IF NOT EXISTS idx_concession_requests_created ON concession_requests(created_at DESC);

-- 3. Instruction acknowledgement timestamp ----------------------------------
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
