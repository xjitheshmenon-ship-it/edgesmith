-- 005_faridabad_weld_bom.sql
-- BOM (Bill of Materials) for each welded block at the Faridabad welding
-- workstation (WELD-01, step 8). A "final block" sent to rolling is built by
-- welding several input pieces together; this table records those components
-- per weld so the block's bill of materials is captured at the welding moment.
-- Identity is still NOT retained downstream (rolling erases it) — this is the
-- as-built recipe for the block, not a traceable serial.

CREATE TABLE IF NOT EXISTS faridabad_weld_bom (
  id              SERIAL PRIMARY KEY,
  weld_log_id     INTEGER NOT NULL REFERENCES faridabad_weld_log(id) ON DELETE CASCADE,
  component_type  VARCHAR(20) NOT NULL,          -- 'alloy' | 'ms' | 'other'
  intake_id       INTEGER REFERENCES raw_material_intakes(id),  -- source heat, when known
  description     TEXT,                          -- free text for 'other' / extra detail
  dimensions_mm   VARCHAR(60),                   -- e.g. '1200 x 185 x 80'
  quantity        NUMERIC NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weld_bom_log ON faridabad_weld_bom(weld_log_id);
