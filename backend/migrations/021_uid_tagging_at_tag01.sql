-- §1 — the initial UID tagging happens at the Tagging Table (TAG-01), the same
-- station as child tagging (Step 16B), not at Receiving (RCV-01). Repoint the
-- "UID Tagging" step to TAG-01. Idempotent.

UPDATE cycle_steps
   SET workstation_type_id = (SELECT id FROM workstation_types WHERE code = 'TAG-01')
 WHERE operation_name = 'UID Tagging'
   AND workstation_type_id = (SELECT id FROM workstation_types WHERE code = 'RCV-01');
