-- ============================================================================
-- 036 — Workstation staffing model, minimum operators, missing units
--
-- The rule book (Sections 9 & 24) defines, per workstation:
--   • a minimum operator count (furnace + swap-pool stations need > 1)
--   • a staffing model: 1 = peer-assist, 2 = per-hour swap pool, 3 = crew hard
--     block (furnaces)
--   • STR-HYD is covered by the furnace (HT) crew and takes no separate
--     operator assignment.
--
-- Add the two columns and initialise the values ONCE (guarded by
-- staffing_model IS NULL) so a later Admin edit is never overwritten. On a
-- fresh install the workstation rows don't exist yet at migrate time, so
-- seeds/seed.js runs the same guarded initialisation after inserting them.
-- Also seed the workstation_units that were never created for the swap-pool /
-- inspection stations, so jobs can actually be attached to them.
-- ============================================================================

ALTER TABLE workstation_types ADD COLUMN IF NOT EXISTS staffing_model SMALLINT;      -- 1 peer · 2 swap · 3 crew
ALTER TABLE workstation_types ADD COLUMN IF NOT EXISTS no_direct_assignment BOOLEAN NOT NULL DEFAULT false;

-- Minimum operators per Section 9 (only where > 1; the column already defaults to 1).
UPDATE workstation_types SET min_operators = 3 WHERE code IN ('HT70','HT80','STR-MAN','PRO','PKG') AND staffing_model IS NULL;
UPDATE workstation_types SET min_operators = 2 WHERE code = 'HT90' AND staffing_model IS NULL;

-- Staffing model per Section 24.
UPDATE workstation_types SET staffing_model = 3
  WHERE code IN ('HT70','HT80','HT90','STR-HYD') AND staffing_model IS NULL;         -- crew (STR-HYD covered by HT crew)
UPDATE workstation_types SET staffing_model = 2
  WHERE code IN ('STR-MAN','PRO','PKG','HRC-01') AND staffing_model IS NULL;         -- per-hour swap pool
UPDATE workstation_types SET staffing_model = 1
  WHERE staffing_model IS NULL;                                                       -- everything else = peer assist

-- STR-HYD is covered by the furnace crew — never assigned operators directly.
UPDATE workstation_types SET no_direct_assignment = true WHERE code = 'STR-HYD';

-- Seed the missing single units for swap-pool / inspection stations (idempotent).
INSERT INTO workstation_units (workstation_type_id, unit_code, unit_name)
SELECT wt.id, u.unit_code, u.unit_code
FROM (VALUES ('STR-MAN','STR-MAN-1'), ('PRO','PRO-1'), ('HRC-01','HRC-01-1'), ('PKG','PKG-1'), ('ISP','ISP-1')) AS u(ws_code, unit_code)
JOIN workstation_types wt ON wt.code = u.ws_code
WHERE NOT EXISTS (SELECT 1 FROM workstation_units wu WHERE wu.unit_code = u.unit_code);
