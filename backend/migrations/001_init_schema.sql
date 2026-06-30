-- ============================================================================
-- CPCMS — Initial Database Schema
-- PostgreSQL 14+
-- Edgesmith Tooling India Pvt Ltd
-- ============================================================================

-- ── EXTENSIONS ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for fuzzy/global search

-- ============================================================================
-- REFERENCE / MASTER DATA
-- ============================================================================

CREATE TABLE locations (
  id              SMALLSERIAL PRIMARY KEY,
  code            VARCHAR(20) UNIQUE NOT NULL,      -- 'dharmapuri' | 'faridabad'
  name            VARCHAR(100) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO locations (code, name) VALUES ('dharmapuri','Dharmapuri'), ('faridabad','Faridabad');

CREATE TABLE workstation_types (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(20) UNIQUE NOT NULL,       -- 'BSW-01', 'HT90', 'WELD-01'
  name            VARCHAR(120) NOT NULL,
  category        VARCHAR(40) NOT NULL,              -- cutting/heat_treatment/machining/grinding/finishing/qc/other/joining
  location_id     SMALLINT REFERENCES locations(id), -- NULL = both locations
  status          VARCHAR(20) NOT NULL DEFAULT 'active', -- active|archived
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workstation_units (
  id              SERIAL PRIMARY KEY,
  workstation_type_id INT NOT NULL REFERENCES workstation_types(id),
  unit_code       VARCHAR(30) UNIQUE NOT NULL,        -- 'MM22-1', 'MM22-2', 'HT90-1'
  unit_name       VARCHAR(120),
  status          VARCHAR(20) NOT NULL DEFAULT 'active', -- active|maintenance|archived
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wsu_type ON workstation_units(workstation_type_id);

CREATE TABLE employees (
  id              SERIAL PRIMARY KEY,
  employee_code   VARCHAR(20) UNIQUE NOT NULL,        -- 'EMP-042'
  full_name       VARCHAR(120) NOT NULL,
  username        VARCHAR(60) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  role            VARCHAR(20) NOT NULL,               -- admin|manager|supervisor|operator|service|shopfloor
  location_id     SMALLINT REFERENCES locations(id),  -- NULL = both (admin/manager)
  status          VARCHAR(20) NOT NULL DEFAULT 'active', -- active|inactive
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_role CHECK (role IN ('admin','manager','supervisor','operator','service','shopfloor'))
);
CREATE INDEX idx_emp_location ON employees(location_id);
CREATE INDEX idx_emp_role ON employees(role);

CREATE TABLE badge_types (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,              -- 'HT90 Furnace Certified'
  workstation_type_id INT REFERENCES workstation_types(id),
  expires         BOOLEAN NOT NULL DEFAULT false,
  validity_months SMALLINT,
  description     TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE employee_badges (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id),
  badge_type_id   INT NOT NULL REFERENCES badge_types(id),
  certified_date  DATE NOT NULL,
  certified_by    VARCHAR(120),
  expiry_date     DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, badge_type_id)
);
CREATE INDEX idx_badges_employee ON employee_badges(employee_id);
CREATE INDEX idx_badges_expiry ON employee_badges(expiry_date) WHERE expiry_date IS NOT NULL;

CREATE TABLE shifts_config (
  id              SMALLSERIAL PRIMARY KEY,
  shift_number    SMALLINT NOT NULL UNIQUE,           -- 1, 2, 3
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL
);
INSERT INTO shifts_config (shift_number, start_time, end_time) VALUES
  (1,'06:00','14:00'), (2,'14:00','22:00'), (3,'22:00','06:00');

CREATE TABLE products (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,
  code            VARCHAR(30) UNIQUE NOT NULL,
  default_cycle_type_id INT,                          -- FK added after cycle_types created
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sizes (
  id              SERIAL PRIMARY KEY,
  size_mm         INT UNIQUE NOT NULL,
  description     VARCHAR(120),
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO sizes (size_mm, description) VALUES
  (1500,'Standard finished length'), (1424,'Alternate standard'), (2750,'Long bar — for converting');

CREATE TABLE designs (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(40) UNIQUE NOT NULL,         -- 'Plain', '9/8534', '9/5032'
  description     VARCHAR(200),
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO designs (code) VALUES ('Plain'), ('9/8534'), ('9/5032');

CREATE TABLE design_valid_sizes (
  design_id       INT NOT NULL REFERENCES designs(id),
  size_id         INT NOT NULL REFERENCES sizes(id),
  PRIMARY KEY (design_id, size_id)
);

CREATE TABLE suppliers (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,
  material_type   VARCHAR(20) NOT NULL,                -- alloy_steel | ms | both
  contact_details TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_material_type CHECK (material_type IN ('alloy_steel','ms','both'))
);

CREATE TABLE contractors (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,
  contact_details TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE truck_capacity (
  id              SERIAL PRIMARY KEY,
  contractor_id   INT REFERENCES contractors(id),       -- NULL = default rule
  max_blocks      INT NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE color_codes (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(40) UNIQUE NOT NULL,          -- 'Blue', 'Red'
  hex_swatch      VARCHAR(7) NOT NULL,                  -- '#2D6FB5'
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alloy_grade_cycle_map (
  id              SERIAL PRIMARY KEY,
  alloy_grade     VARCHAR(40) UNIQUE NOT NULL,          -- 'Grade A1'
  cycle_type_code VARCHAR(10) NOT NULL,                 -- 'EAT' | 'SWAN' | 'OVEN'
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_cycle_code CHECK (cycle_type_code IN ('EAT','SWAN','OVEN'))
);

CREATE TABLE conversion_patterns (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(40) NOT NULL,                 -- 'Pattern A'
  input_length_mm INT NOT NULL,
  child_lengths_mm INT[] NOT NULL,                      -- [1500,1500,1424]
  kerf_mm         SMALLINT NOT NULL DEFAULT 3,
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO conversion_patterns (name, input_length_mm, child_lengths_mm) VALUES
  ('Pattern A', 4500, ARRAY[1500,1500,1424]),
  ('Pattern B', 3000, ARRAY[1500,1424]);

CREATE TABLE storage_locations (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(20) NOT NULL,                 -- 'RM-Q', 'MC-D'
  name            VARCHAR(120),
  location_id     SMALLINT NOT NULL REFERENCES locations(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  UNIQUE(code, location_id)
);
INSERT INTO storage_locations (code, name, location_id) VALUES
  ('RM','Raw Material',1), ('RM-Q','RM Queue',1), ('RM-D','RM Done',1),
  ('HT-Q','Furnace Queue',1), ('HT-D','Furnace Out',1),
  ('MC-Q','Machine Queue',1), ('MC-D','Machine Done',1),
  ('QC-Q','QC Queue',1), ('QC-D','QC Cleared',1), ('FG','Finished Goods',1);

-- ============================================================================
-- CYCLE CONFIGURATION (versioned)
-- ============================================================================

CREATE TABLE cycle_types (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(10) UNIQUE NOT NULL,           -- 'EAT','SWAN','OVEN'
  name            VARCHAR(60) NOT NULL,
  location_id     SMALLINT REFERENCES locations(id),     -- which location this cycle runs at
  letter          CHAR(1) NOT NULL,                       -- starting UID series letter
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO cycle_types (code, name, location_id, letter) VALUES
  ('EAT','EAT Cycle', 1, 'E'),
  ('SWAN','SWAN Cycle', 1, 'S'),
  ('OVEN','OVEN Cycle', 1, 'O');

ALTER TABLE products ADD CONSTRAINT fk_products_cycle
  FOREIGN KEY (default_cycle_type_id) REFERENCES cycle_types(id);

CREATE TABLE cycle_versions (
  id              SERIAL PRIMARY KEY,
  cycle_type_id   INT NOT NULL REFERENCES cycle_types(id),
  version_number  INT NOT NULL,
  changed_by      INT REFERENCES employees(id),
  change_summary  TEXT,
  is_current      BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cycle_type_id, version_number)
);
CREATE INDEX idx_cycle_versions_current ON cycle_versions(cycle_type_id, is_current) WHERE is_current = true;

CREATE TABLE cycle_steps (
  id              SERIAL PRIMARY KEY,
  cycle_version_id INT NOT NULL REFERENCES cycle_versions(id) ON DELETE CASCADE,
  step_number     VARCHAR(5) NOT NULL,                   -- '1','16','16B'
  sequence_order  INT NOT NULL,                          -- for sorting (16B sorts after 16)
  operation_name  VARCHAR(120) NOT NULL,
  workstation_type_id INT NOT NULL REFERENCES workstation_types(id),
  source_storage_id INT REFERENCES storage_locations(id),
  dest_storage_id INT REFERENCES storage_locations(id),
  step_type       VARCHAR(20) NOT NULL DEFAULT 'normal', -- normal|temper|split
  capacity_1500   INT,                                    -- base capacity at 1500mm; NULL for length-based steps
  capacity_basis  VARCHAR(20) NOT NULL DEFAULT 'fixed',   -- fixed|furnace_scaled|length_based
  min_queue_threshold INT DEFAULT 1,
  UNIQUE(cycle_version_id, step_number)
);
CREATE INDEX idx_cycle_steps_version ON cycle_steps(cycle_version_id);

-- Step capacity per workstation unit (for multi-unit workstations like MM22-1/MM22-2)
CREATE TABLE step_unit_capacity (
  id              SERIAL PRIMARY KEY,
  cycle_step_id   INT NOT NULL REFERENCES cycle_steps(id) ON DELETE CASCADE,
  workstation_unit_id INT NOT NULL REFERENCES workstation_units(id),
  capacity_1500   INT NOT NULL DEFAULT 1,
  UNIQUE(cycle_step_id, workstation_unit_id)
);

-- Batch rules per step
CREATE TABLE step_batch_rules (
  id              SERIAL PRIMARY KEY,
  cycle_step_id   INT NOT NULL UNIQUE REFERENCES cycle_steps(id) ON DELETE CASCADE,
  capacity_type   VARCHAR(20) NOT NULL DEFAULT 'count',   -- count|weight|time_slots|unlimited
  min_batch_size  INT NOT NULL DEFAULT 0,
  selection_rule  VARCHAR(30) NOT NULL DEFAULT 'priority_fifo', -- priority_fifo|fifo_only|dimension_match
  cycle_type_mix  VARCHAR(20) NOT NULL DEFAULT 'any',     -- any|same_cycle
  trigger_mode    VARCHAR(20) NOT NULL DEFAULT 'auto',    -- auto|manual|operator_pick
  dimension_tolerance_mm INT
);

-- Grinding machine length rules (SG-DLT, AG-ALP, AG-BTA, AG-GMM)
CREATE TABLE grinding_machine_rules (
  id              SERIAL PRIMARY KEY,
  workstation_type_id INT NOT NULL REFERENCES workstation_types(id),
  max_length_mm   INT NOT NULL,
  bars_per_set    INT,                                    -- only for bunch grinding (NULL otherwise)
  bed_length_mm   INT,                                    -- only for bunch grinding
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
);

-- Tempering parameters per cycle type per tempering step
CREATE TABLE tempering_parameters (
  id              SERIAL PRIMARY KEY,
  cycle_type_id   INT NOT NULL REFERENCES cycle_types(id),
  tempering_step  VARCHAR(20) NOT NULL,                   -- 'tempering_1'|'tempering_2'|'tempering_3'|'tempering_4'
  target_temp_c   NUMERIC(6,2) NOT NULL,
  target_soak_min INT NOT NULL,
  tolerance_temp_c NUMERIC(5,2) NOT NULL DEFAULT 5,
  tolerance_soak_min INT NOT NULL DEFAULT 5,
  changed_by      INT REFERENCES employees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cycle_type_id, tempering_step)
);

-- ============================================================================
-- FARIDABAD OPERATIONS (no UIDs — batch/quantity-level)
-- ============================================================================

CREATE TABLE raw_material_intakes (
  id              SERIAL PRIMARY KEY,
  material_type   VARCHAR(20) NOT NULL,                   -- alloy_steel | ms
  supplier_id     INT NOT NULL REFERENCES suppliers(id),
  heat_number     VARCHAR(40) NOT NULL,
  grade           VARCHAR(40),                            -- only for alloy_steel
  cycle_type_id   INT REFERENCES cycle_types(id),          -- derived from grade for alloy_steel
  steel_grade     VARCHAR(40),
  weight_kg       NUMERIC(10,2) NOT NULL,
  bar_count       INT NOT NULL,
  dimensions_mm   VARCHAR(30),
  date_received   DATE NOT NULL,
  po_reference    VARCHAR(60),
  notes           TEXT,
  created_by      INT REFERENCES employees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_material_type_intake CHECK (material_type IN ('alloy_steel','ms'))
);
CREATE INDEX idx_intake_heat ON raw_material_intakes(heat_number);
CREATE INDEX idx_intake_cycle ON raw_material_intakes(cycle_type_id);

-- Faridabad weld log — individual welds, feeds the running tally (no per-block record retained)
CREATE TABLE faridabad_weld_log (
  id              SERIAL PRIMARY KEY,
  cycle_type_id   INT NOT NULL REFERENCES cycle_types(id),
  alloy_intake_id INT REFERENCES raw_material_intakes(id),
  ms_intake_id    INT REFERENCES raw_material_intakes(id),
  operator_id     INT REFERENCES employees(id),
  workstation_unit_id INT REFERENCES workstation_units(id), -- e.g. WB-1, WB-2
  size_mm         INT,
  net_work_seconds INT,
  started_at      TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,
  dispatched      BOOLEAN NOT NULL DEFAULT false,           -- true once counted into a dispatch batch
  dispatch_batch_id INT,                                     -- FK added after contractor_dispatches created
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_weld_cycle ON faridabad_weld_log(cycle_type_id);
CREATE INDEX idx_weld_dispatched ON faridabad_weld_log(dispatched) WHERE dispatched = false;

CREATE TABLE contractor_dispatches (
  id              SERIAL PRIMARY KEY,
  batch_reference VARCHAR(40) UNIQUE NOT NULL,              -- 'FAR-DISP-2024-061'
  cycle_type_id   INT NOT NULL REFERENCES cycle_types(id),
  color_code_id   INT NOT NULL REFERENCES color_codes(id),
  block_count     INT NOT NULL,
  contractor_id   INT NOT NULL REFERENCES contractors(id),
  possible_alloy_heats TEXT[],                               -- array of heat numbers possibly included
  possible_ms_heats TEXT[],
  date_dispatched DATE NOT NULL,
  expected_delivery_date DATE,
  challan_reference VARCHAR(60),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',     -- pending|partially_received|fully_received
  created_by      INT REFERENCES employees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dispatch_status ON contractor_dispatches(status);

ALTER TABLE faridabad_weld_log ADD CONSTRAINT fk_weld_dispatch
  FOREIGN KEY (dispatch_batch_id) REFERENCES contractor_dispatches(id);

CREATE TABLE receiving_events (
  id              SERIAL PRIMARY KEY,
  receiving_reference VARCHAR(40) UNIQUE NOT NULL,           -- 'DHR-RCV-2024-088'
  dispatch_batch_id INT NOT NULL REFERENCES contractor_dispatches(id),
  block_count     INT NOT NULL,
  color_code_on_arrival_id INT REFERENCES color_codes(id),
  color_match     BOOLEAN,                                    -- false triggers supervisor confirmation requirement
  condition       VARCHAR(20) NOT NULL DEFAULT 'good',         -- good|minor_damage|significant_damage
  condition_notes TEXT,
  received_by     INT REFERENCES employees(id),
  date_received   DATE NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'awaiting_cut', -- awaiting_cut|in_production|complete
  blocks_cut      INT NOT NULL DEFAULT 0,                      -- running counter as BSW-01 consumes blocks
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_receiving_dispatch ON receiving_events(dispatch_batch_id);
CREATE INDEX idx_receiving_status ON receiving_events(status);

-- ============================================================================
-- UIDs AND PRODUCTION (Dharmapuri)
-- ============================================================================

CREATE TABLE uid_series (
  cycle_type_id   INT PRIMARY KEY REFERENCES cycle_types(id),
  current_letter  CHAR(1) NOT NULL,
  next_number     INT NOT NULL DEFAULT 1
);
INSERT INTO uid_series (cycle_type_id, current_letter, next_number)
  SELECT id, letter, 1 FROM cycle_types;

CREATE TABLE manufacturing_orders (
  id              SERIAL PRIMARY KEY,
  mo_number       VARCHAR(40) UNIQUE NOT NULL,
  customer        VARCHAR(120),
  quantity        INT,
  size_id         INT REFERENCES sizes(id),
  design_id       INT REFERENCES designs(id),
  priority        VARCHAR(10) NOT NULL DEFAULT 'Normal',       -- High|Normal|Low
  required_delivery_date DATE,
  status          VARCHAR(20) NOT NULL DEFAULT 'open',          -- open|active|partially_dispatched|fully_dispatched
  notes           TEXT,
  created_by      INT REFERENCES employees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_priority CHECK (priority IN ('High','Normal','Low'))
);
CREATE INDEX idx_mo_status ON manufacturing_orders(status);

CREATE TABLE uids (
  id              BIGSERIAL PRIMARY KEY,
  uid_code        VARCHAR(20) UNIQUE NOT NULL,                 -- 'E043', 'E042-A'
  parent_uid_id   BIGINT REFERENCES uids(id),
  cycle_version_id INT NOT NULL REFERENCES cycle_versions(id),  -- locks the UID to the cycle version active at creation
  current_step    VARCHAR(5) NOT NULL DEFAULT '1',
  current_storage_id INT REFERENCES storage_locations(id),
  current_workstation_unit_id INT REFERENCES workstation_units(id),
  product_id      INT REFERENCES products(id),
  size_id         INT REFERENCES sizes(id),
  design_id       INT REFERENCES designs(id),
  mo_id           INT REFERENCES manufacturing_orders(id),
  priority        VARCHAR(10) NOT NULL DEFAULT 'Normal',
  status          VARCHAR(20) NOT NULL DEFAULT 'active',         -- active|hold|done|scrap
  hold_reason     TEXT,
  -- Material traceability (from Faridabad)
  receiving_event_id INT REFERENCES receiving_events(id),
  dispatch_batch_id INT REFERENCES contractor_dispatches(id),
  created_by      INT REFERENCES employees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_uid_status CHECK (status IN ('active','hold','done','scrap')),
  CONSTRAINT chk_uid_priority CHECK (priority IN ('High','Normal','Low'))
);
CREATE INDEX idx_uids_status ON uids(status);
CREATE INDEX idx_uids_current_step ON uids(current_step);
CREATE INDEX idx_uids_storage ON uids(current_storage_id);
CREATE INDEX idx_uids_priority ON uids(priority);
CREATE INDEX idx_uids_cycle_version ON uids(cycle_version_id);
CREATE INDEX idx_uids_mo ON uids(mo_id);
CREATE INDEX idx_uids_parent ON uids(parent_uid_id);
CREATE INDEX idx_uids_code_trgm ON uids USING gin (uid_code gin_trgm_ops);

CREATE TABLE split_events (
  id              SERIAL PRIMARY KEY,
  parent_uid_id   BIGINT NOT NULL REFERENCES uids(id),
  split_step      VARCHAR(5) NOT NULL DEFAULT '16',
  conversion_pattern_id INT REFERENCES conversion_patterns(id),
  input_length_mm INT NOT NULL,
  child_lengths_mm INT[] NOT NULL,
  cuts            INT NOT NULL,
  kerf_total_mm   INT NOT NULL,
  scrap_mm        INT NOT NULL,
  scrap_reason    VARCHAR(40),
  reason_notes    TEXT,
  authorised_by   INT REFERENCES employees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_split_parent ON split_events(parent_uid_id);

CREATE TABLE uid_step_logs (
  id              BIGSERIAL PRIMARY KEY,
  uid_id          BIGINT NOT NULL REFERENCES uids(id),
  step_number     VARCHAR(5) NOT NULL,
  operation_name  VARCHAR(120),
  workstation_unit_id INT REFERENCES workstation_units(id),
  operator_id     INT REFERENCES employees(id),
  shift_id        INT,                                          -- FK added after shifts table created
  started_at      TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,
  net_work_seconds INT,
  total_elapsed_seconds INT,
  qc_check_type   VARCHAR(40),
  qc_value        VARCHAR(40),
  qc_result       VARCHAR(20),                                  -- Pass|Fail|Borderline
  furnace_batch_id INT,                                          -- FK added after furnace_batches created
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_step_logs_uid ON uid_step_logs(uid_id);
CREATE INDEX idx_step_logs_step ON uid_step_logs(step_number);
CREATE INDEX idx_step_logs_closed ON uid_step_logs(closed_at);

CREATE TABLE uid_pauses (
  id              BIGSERIAL PRIMARY KEY,
  step_log_id     BIGINT NOT NULL REFERENCES uid_step_logs(id) ON DELETE CASCADE,
  paused_at       TIMESTAMPTZ NOT NULL,
  resumed_at      TIMESTAMPTZ,
  reason          VARCHAR(40) NOT NULL,                          -- Break|Machine issue|Material not ready|Waiting for supervisor|Other
  notes           TEXT,
  duration_seconds INT
);
CREATE INDEX idx_pauses_steplog ON uid_pauses(step_log_id);

-- ============================================================================
-- FURNACE BATCHES (HT70 Hardening, HT80 Quenching, HT90 Tempering x4)
-- ============================================================================

CREATE TABLE furnace_batches (
  id              SERIAL PRIMARY KEY,
  batch_number    VARCHAR(40) UNIQUE NOT NULL,                  -- 'HT90-T1-2024-441'
  cycle_step_id   INT NOT NULL REFERENCES cycle_steps(id),
  cycle_type_id   INT NOT NULL REFERENCES cycle_types(id),       -- hard rule: one cycle type per batch
  workstation_unit_id INT REFERENCES workstation_units(id),
  target_temp_c   NUMERIC(6,2),
  target_soak_min INT,
  actual_temp_c   NUMERIC(6,2),
  actual_soak_min INT,
  deviation_flag  BOOLEAN NOT NULL DEFAULT false,
  deviation_acknowledged_by INT REFERENCES employees(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'loading',         -- loading|ready|running|complete
  started_at      TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,
  operator_id     INT REFERENCES employees(id),
  shift_id        INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_furnace_status CHECK (status IN ('loading','ready','running','complete'))
);
CREATE INDEX idx_furnace_step ON furnace_batches(cycle_step_id);
CREATE INDEX idx_furnace_status ON furnace_batches(status);

CREATE TABLE furnace_batch_uids (
  furnace_batch_id INT NOT NULL REFERENCES furnace_batches(id) ON DELETE CASCADE,
  uid_id          BIGINT NOT NULL REFERENCES uids(id),
  PRIMARY KEY (furnace_batch_id, uid_id)
);
CREATE INDEX idx_fbu_uid ON furnace_batch_uids(uid_id);

ALTER TABLE uid_step_logs ADD CONSTRAINT fk_steplog_furnace
  FOREIGN KEY (furnace_batch_id) REFERENCES furnace_batches(id);

-- General production batches (grinding etc.)
CREATE TABLE production_batches (
  id              SERIAL PRIMARY KEY,
  batch_number    VARCHAR(40) UNIQUE NOT NULL,
  cycle_step_id   INT NOT NULL REFERENCES cycle_steps(id),
  workstation_unit_id INT REFERENCES workstation_units(id),
  combined_length_mm INT,                                       -- for length-based grinding batches
  status          VARCHAR(20) NOT NULL DEFAULT 'loading',
  started_at      TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,
  operator_id     INT REFERENCES employees(id),
  shift_id        INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE production_batch_uids (
  production_batch_id INT NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  uid_id          BIGINT NOT NULL REFERENCES uids(id),
  set_number      SMALLINT,                                     -- for bunch grinding (set 1 / set 2)
  PRIMARY KEY (production_batch_id, uid_id)
);

-- ============================================================================
-- SHIFTS AND JOBS
-- ============================================================================

CREATE TABLE shifts (
  id              SERIAL PRIMARY KEY,
  shift_date      DATE NOT NULL,
  shift_number    SMALLINT NOT NULL REFERENCES shifts_config(shift_number),
  location_id     SMALLINT NOT NULL REFERENCES locations(id),
  supervisor_id   INT REFERENCES employees(id),
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shift_date, shift_number, location_id)
);
CREATE INDEX idx_shifts_date_loc ON shifts(shift_date, location_id);

ALTER TABLE uid_step_logs ADD CONSTRAINT fk_steplog_shift FOREIGN KEY (shift_id) REFERENCES shifts(id);
ALTER TABLE furnace_batches ADD CONSTRAINT fk_furnace_shift FOREIGN KEY (shift_id) REFERENCES shifts(id);
ALTER TABLE production_batches ADD CONSTRAINT fk_prodbatch_shift FOREIGN KEY (shift_id) REFERENCES shifts(id);

CREATE TABLE shift_schedule (
  id              SERIAL PRIMARY KEY,
  shift_date      DATE NOT NULL,
  shift_number    SMALLINT NOT NULL,
  location_id     SMALLINT NOT NULL REFERENCES locations(id),
  supervisor_id   INT REFERENCES employees(id),
  operator_ids    INT[],
  published       BOOLEAN NOT NULL DEFAULT false,
  created_by      INT REFERENCES employees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shift_date, shift_number, location_id)
);

CREATE TABLE shift_handovers (
  id              SERIAL PRIMARY KEY,
  shift_id        INT NOT NULL REFERENCES shifts(id),
  outgoing_supervisor_id INT REFERENCES employees(id),
  incoming_supervisor_id INT REFERENCES employees(id),
  workstation_status_snapshot JSONB,
  furnace_batches_in_progress JSONB,
  holds_summary   JSONB,
  equipment_issues TEXT,
  urgent_notes    TEXT,
  submitted_at    TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_handover_shift ON shift_handovers(shift_id);

-- Workstation assignment per shift (operator -> workstation, many-to-many)
CREATE TABLE workstation_assignments (
  id              SERIAL PRIMARY KEY,
  shift_id        INT NOT NULL REFERENCES shifts(id),
  employee_id     INT NOT NULL REFERENCES employees(id),
  workstation_type_id INT NOT NULL REFERENCES workstation_types(id),
  assigned_by     INT REFERENCES employees(id),
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  unassigned_at   TIMESTAMPTZ,
  UNIQUE(shift_id, employee_id, workstation_type_id)
);
CREATE INDEX idx_wsassign_shift ON workstation_assignments(shift_id);
CREATE INDEX idx_wsassign_employee ON workstation_assignments(employee_id);

-- Jobs: the unit of work an operator executes (UID-based at Dharmapuri, size+cycle based at Faridabad)
CREATE TABLE jobs (
  id              BIGSERIAL PRIMARY KEY,
  shift_id        INT NOT NULL REFERENCES shifts(id),
  uid_id          BIGINT REFERENCES uids(id),                    -- NULL for Faridabad jobs
  weld_log_id     INT REFERENCES faridabad_weld_log(id),         -- NULL for Dharmapuri jobs
  cycle_step_id   INT REFERENCES cycle_steps(id),
  workstation_unit_id INT REFERENCES workstation_units(id),
  operator_id     INT REFERENCES employees(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'queued',          -- queued|in_progress|paused|closed
  assigned_by     INT REFERENCES employees(id),
  assignment_type VARCHAR(10) NOT NULL DEFAULT 'auto',            -- auto|manual
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_job_status CHECK (status IN ('queued','in_progress','paused','closed'))
);
CREATE INDEX idx_jobs_shift ON jobs(shift_id);
CREATE INDEX idx_jobs_operator ON jobs(operator_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_uid ON jobs(uid_id);

-- ============================================================================
-- ALERTS
-- ============================================================================

CREATE TABLE alerts (
  id              BIGSERIAL PRIMARY KEY,
  alert_type      VARCHAR(40) NOT NULL,                          -- hold|design_missing|furnace_deviation|qc_fail|badge_expiring|handover_overdue|new_job|receiving_overdue|pause_threshold
  severity        VARCHAR(10) NOT NULL DEFAULT 'warning',         -- critical|warning|info
  location_id     SMALLINT REFERENCES locations(id),
  uid_id          BIGINT REFERENCES uids(id),
  message         TEXT NOT NULL,
  target_role     VARCHAR(20),                                    -- which role should see this
  target_employee_id INT REFERENCES employees(id),
  link_page       VARCHAR(60),
  link_record_id  VARCHAR(60),
  status          VARCHAR(20) NOT NULL DEFAULT 'active',           -- active|dismissed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  dismissed_at    TIMESTAMPTZ,
  CONSTRAINT chk_severity CHECK (severity IN ('critical','warning','info'))
);
CREATE INDEX idx_alerts_location ON alerts(location_id);
CREATE INDEX idx_alerts_status ON alerts(status) WHERE status = 'active';
CREATE INDEX idx_alerts_employee ON alerts(target_employee_id);

-- ============================================================================
-- AUDIT LOG (append-only, never deleted)
-- ============================================================================

CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  employee_id     INT REFERENCES employees(id),
  table_name      VARCHAR(60) NOT NULL,
  record_id       VARCHAR(60) NOT NULL,
  action          VARCHAR(10) NOT NULL,                           -- INSERT|UPDATE|DELETE
  before_value    JSONB,
  after_value     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_table_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_employee ON audit_log(employee_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_uids_updated BEFORE UPDATE ON uids
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
