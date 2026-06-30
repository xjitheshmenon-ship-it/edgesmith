-- Faridabad work items: a material item flowing through the 10-step FAR cycle.
-- Faridabad has no UID concept — items are identified by size + cycle type.
CREATE TABLE IF NOT EXISTS faridabad_items (
  id                  SERIAL PRIMARY KEY,
  cycle_type_id       INT NOT NULL REFERENCES cycle_types(id),
  size_mm             INT,
  current_step        VARCHAR(10) NOT NULL DEFAULT '1',
  status              VARCHAR(20) NOT NULL DEFAULT 'queued',  -- queued | in_progress | done
  current_operator_id INT REFERENCES employees(id),
  started_at          TIMESTAMPTZ,                            -- set while in_progress
  priority            VARCHAR(10) NOT NULL DEFAULT 'Normal',
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_far_items_step ON faridabad_items(current_step);
CREATE INDEX IF NOT EXISTS idx_far_items_status ON faridabad_items(status);

-- Per-operation history (timers) for a Faridabad item.
CREATE TABLE IF NOT EXISTS faridabad_item_logs (
  id                SERIAL PRIMARY KEY,
  item_id           INT NOT NULL REFERENCES faridabad_items(id) ON DELETE CASCADE,
  step_number       VARCHAR(10) NOT NULL,
  operation_name    VARCHAR(80),
  operator_id       INT REFERENCES employees(id),
  started_at        TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  net_work_seconds  INT,
  ms_cutting_run_id INT REFERENCES ms_sheet_cutting_runs(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_far_item_logs_item ON faridabad_item_logs(item_id);
