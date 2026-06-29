-- Workstation units + per-step capacity + grinding-machine configuration.
-- Adds the physical-unit pool, per-step capacity, machine length limits, and a
-- small key/value settings table (e.g. bunch-grinding bars-per-set).

-- ── Workstation units (physical machines pooled under a workstation code) ────
CREATE TABLE IF NOT EXISTS workstation_units (
  id                  SERIAL PRIMARY KEY,
  unit_code           VARCHAR(48) UNIQUE NOT NULL,        -- e.g. MM22-1, HT90-2
  workstation_id      INTEGER NOT NULL REFERENCES workstations(id),
  name                VARCHAR(128),
  factory_location_id INTEGER REFERENCES factory_locations(id),
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','maintenance','archived')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ws_units_workstation ON workstation_units(workstation_id);

-- ── Per-step capacity (pieces processed simultaneously, per unit) ────────────
ALTER TABLE cycle_steps ADD COLUMN IF NOT EXISTS capacity_per_unit INTEGER;

-- ── Grinding machine length limit (mm); NULL for non-grinding workstations ───
ALTER TABLE workstations ADD COLUMN IF NOT EXISTS max_bar_length_mm INTEGER;

UPDATE workstations SET max_bar_length_mm = 3000 WHERE code IN ('SG-DLT','AG-GMM');
UPDATE workstations SET max_bar_length_mm = 1500 WHERE code IN ('AG-BTA','AG-ALP');

-- ── App settings (admin-tunable scalars) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key           TEXT PRIMARY KEY,
  value         JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_id INTEGER REFERENCES users(id)
);
INSERT INTO app_settings (key, value) VALUES
  ('bunch_grinding_bars_per_set', '5'),
  ('bunch_grinding_bed_mm', '3000')
ON CONFLICT (key) DO NOTHING;

-- NOTE: data that depends on seeded master rows (grinding machine length limits,
-- example per-step capacities, one unit per workstation) is applied idempotently
-- by the seed routine, which runs after migrations on every boot — see seeds/seed.js.
