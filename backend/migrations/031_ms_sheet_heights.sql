-- ============================================================================
-- 031 — MS sheet HEIGHT standards
--
-- At MS sheet intake the length and width are entered per delivery; only the
-- height/thickness is a fixed standard. The old ms_sheet_sizes (L×W×H) modelled
-- length/width as presets, which is wrong. This is a clean height-only preset
-- list the intake form and Master List use.
-- ============================================================================
CREATE TABLE IF NOT EXISTS ms_sheet_heights (
  id          SERIAL PRIMARY KEY,
  height_mm   INT NOT NULL UNIQUE,
  label       VARCHAR(40),
  status      VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the current standard (80mm), plus any distinct heights already present
-- on the legacy ms_sheet_sizes rows so nothing is lost.
INSERT INTO ms_sheet_heights (height_mm, label) VALUES (80, '80mm')
  ON CONFLICT (height_mm) DO NOTHING;
INSERT INTO ms_sheet_heights (height_mm, label)
  SELECT DISTINCT height_mm, height_mm || 'mm' FROM ms_sheet_sizes WHERE height_mm IS NOT NULL
  ON CONFLICT (height_mm) DO NOTHING;
