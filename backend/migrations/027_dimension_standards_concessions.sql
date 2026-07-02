-- ============================================================================
-- 027 — Master Lists: dimensional standards + quality-exception (concession)
--       colour codes.
--
-- The legacy `sizes` table holds a single scalar `size_mm` and is FK'd widely
-- (uids.size_id, receiving_events.post_rolling_size_id …), so it cannot express
-- length × width × thickness. Rather than migrate that FK graph, this adds a
-- dedicated dimensional reference table used purely as Master List data (intake
-- block sizes, WIP job/alloy/MS sizes, finished-knife sizes with tolerances,
-- post-rolling sizes). A `category` discriminator keeps them in one table with
-- one CRUD surface, shown as separate Master List sub-sections.
-- ============================================================================

CREATE TABLE IF NOT EXISTS dimension_standards (
  id                 SERIAL PRIMARY KEY,
  category           VARCHAR(30) NOT NULL,   -- block_intake|job_wip|alloy_bar_wip|ms_block_wip|rolling_block|fg_knife|post_rolling
  name               VARCHAR(80) NOT NULL,
  length_mm          INT,                    -- NULL = "input" at point of use
  width_mm           INT,                    -- NULL = "input"
  thickness_mm       INT,                    -- thickness (or MS height)
  width_tol_min      NUMERIC(6,2),           -- FG knife tolerances (nullable)
  width_tol_max      NUMERIC(6,2),
  thickness_tol_min  NUMERIC(6,2),
  thickness_tol_max  NUMERIC(6,2),
  notes              TEXT,
  status             VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dimension_category ON dimension_standards(category);

-- Quality-exception (concession) colour codes — distinct from dispatch colour
-- codes. When a piece measures below minimum and a Manager/Admin approves a
-- concession, the physical box is marked in the matching colour.
CREATE TABLE IF NOT EXISTS concession_color_codes (
  id             SERIAL PRIMARY KEY,
  exception_type VARCHAR(40) NOT NULL,       -- 'Width concession' | 'Thickness concession' | 'Both dimensions out'
  color_name     VARCHAR(30) NOT NULL,
  hex            VARCHAR(9),
  trigger_desc   TEXT,
  status         VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Seed the reference tables from the spec (idempotent) ────────────────────
INSERT INTO dimension_standards (category, name, length_mm, width_mm, thickness_mm, width_tol_min, width_tol_max, thickness_tol_min, thickness_tol_max, notes)
SELECT * FROM (VALUES
  ('block_intake', 'Block Standard Long',  4800, 195, 19, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, 'As-rolled long block'),
  ('block_intake', 'Block Standard Short', 3300, 195, 19, NULL, NULL, NULL, NULL, 'As-rolled short block'),
  ('job_wip',      'Job Standard',         1500, 195, 19, NULL, NULL, NULL, NULL, 'Standard finished length'),
  ('job_wip',      'Job Alternate',        1424, 195, 19, NULL, NULL, NULL, NULL, 'Alternate standard'),
  ('job_wip',      'Job Long',             2750, 195, 19, NULL, NULL, NULL, NULL, 'Long — used for Converting'),
  ('alloy_bar_wip','Alloy Bar Cut Long',   1250, 80,  25, NULL, NULL, NULL, NULL, NULL),
  ('alloy_bar_wip','Alloy Bar Cut Short',  850,  80,  25, NULL, NULL, NULL, NULL, NULL),
  ('ms_block_wip', 'MS Block Long',        1250, 185, 80, NULL, NULL, NULL, NULL, NULL),
  ('ms_block_wip', 'MS Block Short',       850,  185, 80, NULL, NULL, NULL, NULL, NULL),
  ('rolling_block','Block for Rolling Long', 1250, 185, 80, NULL, NULL, NULL, NULL, NULL),
  ('rolling_block','Block for Rolling Short',850, 185, 80, NULL, NULL, NULL, NULL, NULL),
  ('fg_knife',     'Knife Standard',       1500, 180, 16, 180, 182, 16, 16.5, NULL),
  ('fg_knife',     'Knife Alternate',      1424, 180, 16, 180, 182, 16, 16.5, NULL),
  ('fg_knife',     'Knife Long',           2750, 180, 16, 180, 182, 16, 16.5, NULL)
) AS v(category, name, length_mm, width_mm, thickness_mm, width_tol_min, width_tol_max, thickness_tol_min, thickness_tol_max, notes)
WHERE NOT EXISTS (SELECT 1 FROM dimension_standards);

INSERT INTO concession_color_codes (exception_type, color_name, hex, trigger_desc)
SELECT * FROM (VALUES
  ('Width concession',     'Blue',  '#2D6FB5', 'Width measured below 180mm'),
  ('Thickness concession', 'Red',   '#E5484D', 'Thickness measured below 16mm'),
  ('Both dimensions out',  'Black', '#111318', 'Both width below 180mm AND thickness below 16mm')
) AS v(exception_type, color_name, hex, trigger_desc)
WHERE NOT EXISTS (SELECT 1 FROM concession_color_codes);
