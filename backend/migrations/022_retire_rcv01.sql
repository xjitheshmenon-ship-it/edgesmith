-- RCV-01 (Receiving / Work Table) is retired — the Tagging Table (TAG-01) is the
-- only tagging/genesis station now. Repoint any lingering step to TAG-01 and
-- archive the workstation so it disappears from active lists. Idempotent.

UPDATE cycle_steps
   SET workstation_type_id = (SELECT id FROM workstation_types WHERE code = 'TAG-01')
 WHERE workstation_type_id = (SELECT id FROM workstation_types WHERE code = 'RCV-01');

UPDATE workstation_types SET status = 'archived' WHERE code = 'RCV-01';
