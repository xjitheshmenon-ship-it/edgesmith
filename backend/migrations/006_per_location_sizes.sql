-- Per-location standard raw-material sizes.
-- Faridabad rolls + cuts stock into standard pieces (after cutting); Dharmapuri
-- receives long stock lengths (before cutting) that feed the Converting step.
-- Existing global product sizes (1500/1424/2750) keep location_id / cut_stage NULL.

ALTER TABLE sizes ADD COLUMN IF NOT EXISTS location_id INT REFERENCES locations(id);
ALTER TABLE sizes ADD COLUMN IF NOT EXISTS cut_stage   VARCHAR(16);  -- before_cut | after_cut | NULL

-- Faridabad standard pieces produced by cutting (after cut).
INSERT INTO sizes (size_mm, description, location_id, cut_stage)
SELECT 1250, 'Faridabad standard — after cutting', (SELECT id FROM locations WHERE code = 'faridabad'), 'after_cut'
WHERE NOT EXISTS (SELECT 1 FROM sizes WHERE size_mm = 1250);

INSERT INTO sizes (size_mm, description, location_id, cut_stage)
SELECT 850, 'Faridabad standard — after cutting', (SELECT id FROM locations WHERE code = 'faridabad'), 'after_cut'
WHERE NOT EXISTS (SELECT 1 FROM sizes WHERE size_mm = 850);

-- Dharmapuri stock lengths received before cutting (feed the Converting step).
INSERT INTO sizes (size_mm, description, location_id, cut_stage)
SELECT 4800, 'Dharmapuri stock length — before cutting', (SELECT id FROM locations WHERE code = 'dharmapuri'), 'before_cut'
WHERE NOT EXISTS (SELECT 1 FROM sizes WHERE size_mm = 4800);

INSERT INTO sizes (size_mm, description, location_id, cut_stage)
SELECT 3300, 'Dharmapuri stock length — before cutting', (SELECT id FROM locations WHERE code = 'dharmapuri'), 'before_cut'
WHERE NOT EXISTS (SELECT 1 FROM sizes WHERE size_mm = 3300);
