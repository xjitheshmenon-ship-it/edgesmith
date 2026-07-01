-- Rule Book: Step 16B is "Child Tagging" and occurs at the Tagging Table (TAG-01).
-- Add the TAG-01 workstation (type + unit) and repoint the existing 16B cycle
-- steps to it, renaming "Child UID Marking" → "Child Tagging". Idempotent.

INSERT INTO workstation_types (code, name, category, location_id)
SELECT 'TAG-01', 'Tagging Table', 'other', (SELECT id FROM locations WHERE code = 'dharmapuri')
WHERE NOT EXISTS (SELECT 1 FROM workstation_types WHERE code = 'TAG-01');

INSERT INTO workstation_units (unit_code, workstation_type_id)
SELECT 'TAG-01-1', (SELECT id FROM workstation_types WHERE code = 'TAG-01')
WHERE NOT EXISTS (SELECT 1 FROM workstation_units WHERE unit_code = 'TAG-01-1');

UPDATE cycle_steps
   SET operation_name = 'Child Tagging',
       workstation_type_id = (SELECT id FROM workstation_types WHERE code = 'TAG-01')
 WHERE step_number = '16B';
