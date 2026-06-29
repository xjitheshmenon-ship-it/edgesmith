-- CPCMS — Configurable Production Cycle Management System
-- Edgesmith Tooling India Pvt Ltd
-- Greenfield schema. Raw SQL, PostgreSQL 14+.
-- Enum-like columns use TEXT with CHECK constraints so Admin-configurable
-- values stay flexible and serialise as plain strings (matching the API contract).

-- ── Reference / master data ────────────────────────────────────────────────

CREATE TABLE factory_locations (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(16) UNIQUE NOT NULL,
  name          VARCHAR(128) NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE workstations (
  id                   SERIAL PRIMARY KEY,
  code                 VARCHAR(32) UNIQUE NOT NULL,
  name                 VARCHAR(128) NOT NULL,
  category             TEXT NOT NULL DEFAULT 'Other'
                         CHECK (category IN ('Cutting','Heat Treatment','Machining','Grinding','Coating','QC','Packing','Other')),
  factory_location_id  INTEGER REFERENCES factory_locations(id),
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE storage_locations (
  id                   SERIAL PRIMARY KEY,
  code                 VARCHAR(32) UNIQUE NOT NULL,
  name                 VARCHAR(128),
  factory_location_id  INTEGER REFERENCES factory_locations(id),
  is_active            BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  username             VARCHAR(64) UNIQUE NOT NULL,
  full_name            VARCHAR(128) NOT NULL,
  email                VARCHAR(256) UNIQUE,
  hashed_password      VARCHAR(256) NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'operator'
                         CHECK (role IN ('admin','manager','supervisor','operator','service','shopfloor')),
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  primary_location_id  INTEGER REFERENCES factory_locations(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ
);

-- ── Products / sizes / designs ──────────────────────────────────────────────

CREATE TABLE sizes (
  id         SERIAL PRIMARY KEY,
  value_mm   INTEGER UNIQUE NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE designs (
  id           SERIAL PRIMARY KEY,
  code         VARCHAR(64) UNIQUE NOT NULL,
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE design_size_validity (
  id         SERIAL PRIMARY KEY,
  design_id  INTEGER NOT NULL REFERENCES designs(id),
  size_id    INTEGER NOT NULL REFERENCES sizes(id)
);

-- ── Cycle configuration (versioned) ─────────────────────────────────────────

CREATE TABLE cycle_types (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(32) UNIQUE NOT NULL,
  letter_prefix  VARCHAR(1) UNIQUE NOT NULL,
  description    TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_archived    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE product_types (
  id                     SERIAL PRIMARY KEY,
  code                   VARCHAR(32) UNIQUE NOT NULL,
  name                   VARCHAR(128) NOT NULL,
  description            TEXT,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  default_cycle_type_id  INTEGER REFERENCES cycle_types(id)
);

CREATE TABLE product_cycle_types (
  product_type_id  INTEGER NOT NULL REFERENCES product_types(id),
  cycle_type_id    INTEGER NOT NULL REFERENCES cycle_types(id)
);

CREATE TABLE cycle_versions (
  id             SERIAL PRIMARY KEY,
  cycle_type_id  INTEGER NOT NULL REFERENCES cycle_types(id),
  version_number INTEGER NOT NULL,
  is_current     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_id  INTEGER REFERENCES users(id),
  change_notes   TEXT
);

CREATE TABLE cycle_steps (
  id                     SERIAL PRIMARY KEY,
  cycle_version_id       INTEGER NOT NULL REFERENCES cycle_versions(id),
  step_number            VARCHAR(8) NOT NULL,
  step_order             INTEGER NOT NULL,
  operation_name         VARCHAR(128) NOT NULL,
  workstation_id         INTEGER NOT NULL REFERENCES workstations(id),
  from_storage_id        INTEGER REFERENCES storage_locations(id),
  to_storage_id          INTEGER REFERENCES storage_locations(id),
  is_converting_step     BOOLEAN NOT NULL DEFAULT FALSE,
  is_child_marking_step  BOOLEAN NOT NULL DEFAULT FALSE,
  is_qc_step             BOOLEAN NOT NULL DEFAULT FALSE,
  extra_config           JSONB
);

-- ── Orders + conversion patterns + batch rules ──────────────────────────────

CREATE TABLE manufacturing_orders (
  id             SERIAL PRIMARY KEY,
  mo_number      VARCHAR(64) UNIQUE NOT NULL,
  customer       VARCHAR(256) NOT NULL,
  quantity       INTEGER NOT NULL,
  size_id        INTEGER REFERENCES sizes(id),
  design_id      INTEGER REFERENCES designs(id),
  status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','in_progress','completed','cancelled')),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_id  INTEGER REFERENCES users(id)
);

CREATE TABLE conversion_patterns (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(64) NOT NULL,
  input_length_mm   INTEGER NOT NULL,
  output_lengths_mm JSONB NOT NULL,
  kerf_mm           INTEGER NOT NULL DEFAULT 3,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE batch_rules (
  id                 SERIAL PRIMARY KEY,
  cycle_version_id   INTEGER NOT NULL REFERENCES cycle_versions(id),
  cycle_step_id      INTEGER NOT NULL REFERENCES cycle_steps(id),
  capacity_type      TEXT,
  capacity_value     DOUBLE PRECISION,
  min_batch_size     INTEGER DEFAULT 1,
  selection_rule     TEXT NOT NULL DEFAULT 'priority_fifo'
                       CHECK (selection_rule IN ('priority_fifo','strict_fifo','dimension_matched')),
  allow_cycle_mixing BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_mode       TEXT NOT NULL DEFAULT 'manual'
                       CHECK (trigger_mode IN ('auto','manual')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_id      INTEGER REFERENCES users(id)
);

-- ── Faridabad operations ────────────────────────────────────────────────────

CREATE TABLE rolling_contractors (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(256) UNIQUE NOT NULL,
  contact_info  VARCHAR(256),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE raw_material_intakes (
  id                 SERIAL PRIMARY KEY,
  material_type      TEXT NOT NULL CHECK (material_type IN ('Alloy Steel','MS')),
  supplier_name      VARCHAR(256) NOT NULL,
  heat_number        VARCHAR(64) NOT NULL,
  steel_grade        VARCHAR(64) NOT NULL,
  weight_kg          DOUBLE PRECISION,
  date_received      DATE NOT NULL,
  num_bars           INTEGER,
  bar_dimensions_mm  VARCHAR(64),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_id      INTEGER REFERENCES users(id)
);

CREATE TABLE joining_operations (
  id                          SERIAL PRIMARY KEY,
  alloy_intake_id             INTEGER NOT NULL REFERENCES raw_material_intakes(id),
  ms_intake_id                INTEGER NOT NULL REFERENCES raw_material_intakes(id),
  num_billets_produced        INTEGER NOT NULL,
  output_billet_dimensions_mm VARCHAR(64),
  operator_name               VARCHAR(128),
  date_joined                 DATE NOT NULL,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_id               INTEGER REFERENCES users(id)
);

CREATE TABLE faridabad_dispatches (
  id                      SERIAL PRIMARY KEY,
  batch_reference         VARCHAR(64) UNIQUE NOT NULL,
  joining_operation_id    INTEGER NOT NULL REFERENCES joining_operations(id),
  rolling_contractor_name VARCHAR(256) NOT NULL,
  num_billets_dispatched  INTEGER NOT NULL,
  date_dispatched         DATE NOT NULL,
  billet_dimensions_mm    VARCHAR(64),
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_id           INTEGER REFERENCES users(id)
);

CREATE TABLE receiving_events (
  id                    SERIAL PRIMARY KEY,
  faridabad_dispatch_id INTEGER NOT NULL REFERENCES faridabad_dispatches(id),
  date_received         DATE NOT NULL,
  num_billets_received  INTEGER NOT NULL,
  condition             VARCHAR(128),
  received_by           VARCHAR(128),
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_id         INTEGER REFERENCES users(id)
);

-- ── Dharmapuri operations: UIDs ─────────────────────────────────────────────

CREATE TABLE uids (
  id                    SERIAL PRIMARY KEY,
  code                  VARCHAR(8) UNIQUE NOT NULL,
  factory_location_id   INTEGER NOT NULL REFERENCES factory_locations(id),
  cycle_type_id         INTEGER NOT NULL REFERENCES cycle_types(id),
  cycle_version_id      INTEGER NOT NULL REFERENCES cycle_versions(id),
  current_step_id       INTEGER REFERENCES cycle_steps(id),
  current_storage_id    INTEGER REFERENCES storage_locations(id),
  product_type_id       INTEGER REFERENCES product_types(id),
  size_id               INTEGER REFERENCES sizes(id),
  design_id             INTEGER REFERENCES designs(id),
  design_confirmed      BOOLEAN NOT NULL DEFAULT FALSE,
  design_locked         BOOLEAN NOT NULL DEFAULT FALSE,
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','on_hold','converting','converted','dispatched','archived')),
  priority              TEXT NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('normal','high','urgent')),
  mo_id                 INTEGER REFERENCES manufacturing_orders(id),
  parent_uid_id         INTEGER REFERENCES uids(id),
  child_suffix          VARCHAR(4),
  faridabad_dispatch_id INTEGER REFERENCES faridabad_dispatches(id),
  receiving_event_id    INTEGER REFERENCES receiving_events(id),
  alloy_supplier        VARCHAR(256),
  alloy_grade           VARCHAR(64),
  alloy_heat_number     VARCHAR(64),
  ms_supplier           VARCHAR(256),
  ms_grade              VARCHAR(64),
  ms_heat_number        VARCHAR(64),
  rolling_contractor    VARCHAR(256),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_id         INTEGER REFERENCES users(id),
  notes                 TEXT,
  flags                 JSONB
);

CREATE TABLE uid_step_history (
  id                    SERIAL PRIMARY KEY,
  uid_id                INTEGER NOT NULL REFERENCES uids(id),
  cycle_step_id         INTEGER NOT NULL REFERENCES cycle_steps(id),
  workstation_id        INTEGER REFERENCES workstations(id),
  factory_location_id   INTEGER REFERENCES factory_locations(id),
  performed_by_id       INTEGER REFERENCES users(id),
  performed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  qc_result             VARCHAR(16),
  qc_values             JSONB,
  notes                 TEXT,
  conversion_pattern_id INTEGER REFERENCES conversion_patterns(id),
  child_uids_created    JSONB
);

CREATE TABLE uid_transfers (
  id               SERIAL PRIMARY KEY,
  uid_id           INTEGER NOT NULL REFERENCES uids(id),
  from_location_id INTEGER NOT NULL REFERENCES factory_locations(id),
  to_location_id   INTEGER NOT NULL REFERENCES factory_locations(id),
  transferred_by_id INTEGER REFERENCES users(id),
  transferred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason           TEXT NOT NULL
);

-- ── Tempering / furnace batches ─────────────────────────────────────────────

CREATE TABLE tempering_parameters (
  id                     SERIAL PRIMARY KEY,
  cycle_type_id          INTEGER NOT NULL REFERENCES cycle_types(id),
  cycle_step_id          INTEGER NOT NULL REFERENCES cycle_steps(id),
  target_temp_c          DOUBLE PRECISION NOT NULL,
  target_soak_minutes    INTEGER NOT NULL,
  tolerance_temp_c       DOUBLE PRECISION NOT NULL DEFAULT 5,
  tolerance_soak_minutes INTEGER NOT NULL DEFAULT 5,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_id          INTEGER REFERENCES users(id)
);

CREATE TABLE furnace_batches (
  id                     SERIAL PRIMARY KEY,
  batch_number           VARCHAR(32) UNIQUE NOT NULL,
  cycle_type_id          INTEGER NOT NULL REFERENCES cycle_types(id),
  cycle_step_id          INTEGER NOT NULL REFERENCES cycle_steps(id),
  tempering_parameter_id INTEGER REFERENCES tempering_parameters(id),
  target_temp_c          DOUBLE PRECISION,
  target_soak_minutes    INTEGER,
  actual_temp_c          DOUBLE PRECISION,
  actual_soak_minutes    INTEGER,
  actuals_recorded       BOOLEAN NOT NULL DEFAULT FALSE,
  deviation_flagged      BOOLEAN NOT NULL DEFAULT FALSE,
  deviation_notes        TEXT,
  started_at             TIMESTAMPTZ,
  ended_at               TIMESTAMPTZ,
  operator_id            INTEGER REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_id          INTEGER REFERENCES users(id)
);

CREATE TABLE furnace_batch_uids (
  id               SERIAL PRIMARY KEY,
  furnace_batch_id INTEGER NOT NULL REFERENCES furnace_batches(id),
  uid_id           INTEGER NOT NULL REFERENCES uids(id),
  step_history_id  INTEGER REFERENCES uid_step_history(id),
  added_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Work management: shifts + job allotments ────────────────────────────────

CREATE TABLE shift_assignments (
  id              SERIAL PRIMARY KEY,
  shift_date      DATE NOT NULL,
  shift_period    TEXT NOT NULL CHECK (shift_period IN ('morning','afternoon','night')),
  workstation_id  INTEGER NOT NULL REFERENCES workstations(id),
  operator_id     INTEGER NOT NULL REFERENCES users(id),
  assigned_by_id  INTEGER NOT NULL REFERENCES users(id),
  confirmed_by_id INTEGER REFERENCES users(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ
);

CREATE TABLE job_allotments (
  id             SERIAL PRIMARY KEY,
  uid_id         INTEGER NOT NULL REFERENCES uids(id),
  operator_id    INTEGER NOT NULL REFERENCES users(id),
  workstation_id INTEGER NOT NULL REFERENCES workstations(id),
  allotted_by_id INTEGER NOT NULL REFERENCES users(id),
  notes          TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Audit log (append-only) ─────────────────────────────────────────────────

CREATE TABLE audit_log (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  table_name  TEXT,
  record_id   TEXT,
  before_val  JSONB,
  after_val   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_uids_status       ON uids(status);
CREATE INDEX idx_uids_current_step ON uids(current_step_id);
CREATE INDEX idx_uids_storage      ON uids(current_storage_id);
CREATE INDEX idx_uids_priority     ON uids(priority);
CREATE INDEX idx_uids_cycle        ON uids(cycle_version_id);
CREATE INDEX idx_uids_mo           ON uids(mo_id);
CREATE INDEX idx_uids_location     ON uids(factory_location_id);
CREATE INDEX idx_uids_parent       ON uids(parent_uid_id);

CREATE INDEX idx_step_hist_uid     ON uid_step_history(uid_id);
CREATE INDEX idx_step_hist_step    ON uid_step_history(cycle_step_id);

CREATE INDEX idx_cycle_steps_ver   ON cycle_steps(cycle_version_id);
CREATE INDEX idx_cycle_vers_type   ON cycle_versions(cycle_type_id);

CREATE INDEX idx_jobs_operator     ON job_allotments(operator_id);
CREATE INDEX idx_jobs_ws           ON job_allotments(workstation_id);
CREATE INDEX idx_jobs_active       ON job_allotments(is_active);

CREATE INDEX idx_fbu_batch         ON furnace_batch_uids(furnace_batch_id);
CREATE INDEX idx_fbu_uid           ON furnace_batch_uids(uid_id);

CREATE INDEX idx_shift_assign_date ON shift_assignments(shift_date, shift_period);
