-- Rule Book §10B: Faridabad has three storage locations — FAR-RM (Raw
-- Material), FAR-MC (Machining), FAR-DSP (Dispatch). Only the Dharmapuri
-- storages were seeded (location_id = 1); add the Faridabad set. Idempotent.

INSERT INTO storage_locations (code, name, location_id)
SELECT v.code, v.name, l.id
  FROM (VALUES
    ('FAR-RM', 'Raw Material'),
    ('FAR-MC', 'Machining'),
    ('FAR-DSP', 'Dispatch')
  ) AS v(code, name)
  CROSS JOIN (SELECT id FROM locations WHERE code = 'faridabad') AS l
 WHERE NOT EXISTS (
   SELECT 1 FROM storage_locations s WHERE s.code = v.code AND s.location_id = l.id
 );
