-- Correct per-step capacities to the authoritative CPCMS capacity table.
-- Fixed steps = 1; HT70/HT80 furnace base = 6; HT90 furnace base = 80;
-- grinding/bunch steps are length/set-based (NULL = not a fixed count).
-- One-time corrective UPDATE for the EAT current version (no-op on a fresh DB
-- where the seed sets these values directly).

DO $$
DECLARE vid INTEGER;
BEGIN
  SELECT v.id INTO vid
    FROM cycle_versions v JOIN cycle_types ct ON ct.id = v.cycle_type_id
   WHERE ct.name = 'EAT' AND v.is_current = TRUE;
  IF vid IS NULL THEN RETURN; END IF;

  UPDATE cycle_steps SET capacity_per_unit = 1
   WHERE cycle_version_id = vid
     AND step_number IN ('1','2','3','5','8','11','13','15','16','16B','17','18','19','21','24','25','26','27');

  UPDATE cycle_steps SET capacity_per_unit = 6
   WHERE cycle_version_id = vid AND step_number IN ('6','7');     -- HT70 / HT80

  UPDATE cycle_steps SET capacity_per_unit = 80
   WHERE cycle_version_id = vid AND step_number IN ('9','10','14','23'); -- HT90 tempering

  UPDATE cycle_steps SET capacity_per_unit = NULL
   WHERE cycle_version_id = vid AND step_number IN ('4','12','20','22'); -- length / set based
END $$;
