-- Skill enforcement: each workstation type may require a skill certification
-- (badge_types.code) to operate. This maps the skill badges (GRIND, HT, MILL,
-- CUT, TAG, COAT, INSP, STR) to the stations that need them, replacing the old
-- (now-unused) per-workstation badge_types.workstation_type_id link.
--
-- Stations not listed require no certification (Receiving, Packing, Welding,
-- V-Grooving, Intake, Dispatch). Idempotent: only fills a code that is unset,
-- so an admin edit is never overwritten on re-run.

ALTER TABLE workstation_types ADD COLUMN IF NOT EXISTS required_skill_code VARCHAR(20);

UPDATE workstation_types wt
   SET required_skill_code = m.skill
  FROM (VALUES
    ('BSW-01', 'CUT'), ('BSW-02', 'CUT'),
    ('TAG-01', 'TAG'),
    ('HT70', 'HT'), ('HT80', 'HT'), ('HT90', 'HT'),
    ('STR-HYD', 'STR'), ('STR-MAN', 'STR'),
    ('MM22', 'MILL'), ('MM11', 'MILL'),
    ('SG-DLT', 'GRIND'), ('AG-ALP', 'GRIND'), ('AG-BTA', 'GRIND'), ('AG-GMM', 'GRIND'),
    ('PRO', 'COAT'),
    ('HRC-01', 'INSP'), ('VCL-200', 'INSP'), ('ISP', 'INSP'),
    ('FAR-AC', 'CUT'), ('FAR-AG', 'GRIND'), ('FAR-MSC', 'CUT'), ('FAR-MSL', 'CUT')
  ) AS m(code, skill)
 WHERE wt.code = m.code
   AND wt.required_skill_code IS NULL;
