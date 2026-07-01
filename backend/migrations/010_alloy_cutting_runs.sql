-- Alloy-steel bar cutting runs.
-- Each raw bar is cut into standard pieces (1250/850 mm) with minimum wastage.
-- We keep the per-bar plan and rolled-up totals for traceability + yield reports.
CREATE TABLE IF NOT EXISTS alloy_cutting_runs (
  id                 SERIAL PRIMARY KEY,
  alloy_intake_id    INT REFERENCES raw_material_intakes(id),
  faridabad_item_id  INT REFERENCES faridabad_items(id),
  sizes              JSONB NOT NULL,          -- target cut lengths, e.g. [1250, 850]
  kerf_mm            INT NOT NULL DEFAULT 0,
  bars               JSONB NOT NULL,          -- [{ barLengthMm, cuts:[{size,qty}], usedMm, wastageMm }]
  total_pieces       INT NOT NULL DEFAULT 0,
  total_wastage_mm   INT NOT NULL DEFAULT 0,
  totals             JSONB,                   -- rolled-up { bySize, totalBarLengthMm, ... }
  operator_id        INT REFERENCES employees(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alloy_cutting_runs_intake ON alloy_cutting_runs(alloy_intake_id);
