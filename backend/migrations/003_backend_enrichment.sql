-- Backend enrichment: skill badges, shift handovers, job-execution timing,
-- and tempering-parameter version history. All idempotent (IF NOT EXISTS) so
-- the routine can re-run safely on every boot.

-- ── Employee skill badges (certifications with expiry) ──────────────────────
CREATE TABLE IF NOT EXISTS employee_badges (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  badge_code      VARCHAR(48) NOT NULL,          -- workstation/skill code, e.g. MM22, HT90, QC
  badge_name      VARCHAR(128) NOT NULL,
  workstation_id  INTEGER REFERENCES workstations(id),
  certified_at    DATE NOT NULL DEFAULT CURRENT_DATE,
  expires_at      DATE,
  certified_by_id INTEGER REFERENCES users(id),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_badges_user ON employee_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_emp_badges_code ON employee_badges(badge_code);

-- ── Shift handovers (submit by outgoing supervisor, acknowledge by incoming) ─
CREATE TABLE IF NOT EXISTS shift_handovers (
  id                     SERIAL PRIMARY KEY,
  shift_date             DATE NOT NULL,
  shift_period           TEXT NOT NULL CHECK (shift_period IN ('morning','afternoon','night')),
  factory_location_id    INTEGER REFERENCES factory_locations(id),
  outgoing_supervisor_id INTEGER REFERENCES users(id),
  incoming_supervisor_id INTEGER REFERENCES users(id),
  furnace_notes          TEXT,
  on_hold_notes          TEXT,
  equipment_issues       TEXT,
  urgent_notes           TEXT,
  workstation_status     JSONB,                  -- per-workstation confirm snapshot
  status                 TEXT NOT NULL DEFAULT 'submitted'
                           CHECK (status IN ('submitted','acknowledged')),
  submitted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_by_id        INTEGER REFERENCES users(id),
  acknowledged_at        TIMESTAMPTZ,
  acknowledged_by_id     INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_handover_date ON shift_handovers(shift_date, shift_period);

-- ── Job-execution events (start / pause / resume / complete timing) ─────────
CREATE TABLE IF NOT EXISTS job_events (
  id             SERIAL PRIMARY KEY,
  uid_id         INTEGER NOT NULL REFERENCES uids(id),
  cycle_step_id  INTEGER REFERENCES cycle_steps(id),
  workstation_id INTEGER REFERENCES workstations(id),
  operator_id    INTEGER REFERENCES users(id),
  event_type     TEXT NOT NULL CHECK (event_type IN ('start','pause','resume','complete')),
  reason         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_events_uid ON job_events(uid_id);
CREATE INDEX IF NOT EXISTS idx_job_events_operator ON job_events(operator_id);

-- ── Tempering parameter version history ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS tempering_parameter_versions (
  id                     SERIAL PRIMARY KEY,
  parameter_id           INTEGER NOT NULL REFERENCES tempering_parameters(id),
  cycle_type_id          INTEGER,
  cycle_step_id          INTEGER,
  target_temp_c          DOUBLE PRECISION,
  target_soak_minutes    INTEGER,
  tolerance_temp_c       DOUBLE PRECISION,
  tolerance_soak_minutes INTEGER,
  changed_by_id          INTEGER REFERENCES users(id),
  changed_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_temper_versions_param ON tempering_parameter_versions(parameter_id);

-- ── Pause-threshold setting (admin-tunable, minutes) ────────────────────────
INSERT INTO app_settings (key, value) VALUES ('max_pause_minutes', '30')
ON CONFLICT (key) DO NOTHING;
