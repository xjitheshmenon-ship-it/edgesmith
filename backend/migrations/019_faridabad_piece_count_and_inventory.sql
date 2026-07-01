-- Rule Book §10A — piece-count verification at each Faridabad step close, and
-- §6 — the FAR-MC quantity-pool inventory that gates the Welding step.

CREATE TABLE IF NOT EXISTS faridabad_piece_counts (
  id                 BIGSERIAL PRIMARY KEY,
  faridabad_item_id  BIGINT REFERENCES faridabad_items(id),
  step_number        VARCHAR(10),
  cycle_type_id      INT REFERENCES cycle_types(id),
  size_mm            INT,
  expected_pieces    INT,
  actual_pieces      INT,
  discrepancy_reason TEXT,
  operator_id        INT REFERENCES employees(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FAR-MC holds in-process pieces as a quantity pool per cycle type + size +
-- material (alloy / ms) — never individual piece IDs (§6, §10A).
CREATE TABLE IF NOT EXISTS far_mc_inventory (
  id             SERIAL PRIMARY KEY,
  cycle_type_id  INT NOT NULL REFERENCES cycle_types(id),
  size_mm        INT NOT NULL,
  material_type  VARCHAR(10) NOT NULL,          -- 'alloy' | 'ms'
  quantity       INT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_type_id, size_mm, material_type)
);
