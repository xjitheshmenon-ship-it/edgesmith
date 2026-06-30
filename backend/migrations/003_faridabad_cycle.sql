-- Faridabad full-cycle corrections: MS sheet cutting balance runs and the
-- two-leg dispatch model (Faridabad → Rolling → Dharmapuri).

-- One record per MS Cutting operation; the balance strips + weight are
-- system-calculated (the operator never measures leftover material).
CREATE TABLE IF NOT EXISTS ms_sheet_cutting_runs (
  id                       SERIAL PRIMARY KEY,
  ms_intake_id             INT REFERENCES raw_material_intakes(id),
  sheet_length_mm          INT NOT NULL,
  sheet_width_mm           INT NOT NULL,
  sheet_height_mm          INT NOT NULL,
  pieces                   JSONB NOT NULL,            -- [{length_mm,width_mm,quantity}]
  strips                   JSONB,                     -- [{width,length,weight}]
  total_balance_weight_kg  NUMERIC(10,2),
  operator_id              INT REFERENCES employees(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Two linked dispatch legs per batch around the external rolling stage. The
-- block never returns to Faridabad; each leg is its own dated event.
CREATE TABLE IF NOT EXISTS batch_dispatch_legs (
  id                  SERIAL PRIMARY KEY,
  dispatch_batch_id   INT NOT NULL REFERENCES contractor_dispatches(id) ON DELETE CASCADE,
  leg                 SMALLINT NOT NULL,             -- 1 = Faridabad→Rolling, 2 = Rolling→Dharmapuri
  dispatched_date     DATE NOT NULL,
  notes               TEXT,
  created_by          INT REFERENCES employees(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_leg CHECK (leg IN (1, 2)),
  UNIQUE (dispatch_batch_id, leg)
);
CREATE INDEX IF NOT EXISTS idx_dispatch_legs_batch ON batch_dispatch_legs(dispatch_batch_id);
