-- ============================================================================
-- 037 — Swap-pool rotation (Model 2 workstations)
--
-- STR-MAN, PRO, PKG and HRC-01 are per-hour swap pools (rule book §10, §24):
-- a pool of operators rotates on a fixed interval (default 60 min). HRC-01 also
-- has one fixed INSP badge holder present the whole shift plus rotating
-- assistants. A Supervisor may override the interval for the current shift.
--
--   swap_schedules — one row per (shift, workstation): the rotation interval.
--   swap_slots     — the generated rotation slots (who is on when).
-- ============================================================================

CREATE TABLE IF NOT EXISTS swap_schedules (
  id                  SERIAL PRIMARY KEY,
  shift_id            INT NOT NULL REFERENCES shifts(id),
  workstation_type_id INT NOT NULL REFERENCES workstation_types(id),
  interval_minutes    INT NOT NULL DEFAULT 60,
  updated_by          INT REFERENCES employees(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shift_id, workstation_type_id)
);

CREATE TABLE IF NOT EXISTS swap_slots (
  id                  BIGSERIAL PRIMARY KEY,
  schedule_id         INT NOT NULL REFERENCES swap_schedules(id) ON DELETE CASCADE,
  shift_id            INT NOT NULL REFERENCES shifts(id),
  workstation_type_id INT NOT NULL REFERENCES workstation_types(id),
  employee_id         INT NOT NULL REFERENCES employees(id),
  slot_index          INT NOT NULL,
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  is_fixed            BOOLEAN NOT NULL DEFAULT false,   -- HRC-01 INSP holder: present all shift
  confirmed_at        TIMESTAMPTZ,
  confirmed_by        INT REFERENCES employees(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_swap_slots_schedule ON swap_slots(schedule_id);
CREATE INDEX IF NOT EXISTS idx_swap_slots_ws_time ON swap_slots(workstation_type_id, starts_at);
