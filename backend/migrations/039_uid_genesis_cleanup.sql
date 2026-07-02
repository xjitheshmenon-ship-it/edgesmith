-- ============================================================================
-- 039 — §1 cleanup: UIDs are born at the Tagging Table
--
-- Band Saw Cutting (step 1) and initial UID Tagging (step 2) are pre-UID: the
-- block is cut into plates, then tagged, and only then does a UID exist. Earlier
-- sample data seeded active UIDs (and jobs) at those steps. Advance any UID still
-- parked at step 1/2 to the post-tagging step (3, storage RM-D), close their open
-- step logs, and drop the invalid Band Saw / initial-Tagging jobs. Idempotent —
-- once no UID sits at step 1/2, re-runs are no-ops.
-- ============================================================================

UPDATE uids
SET current_step = '3',
    current_storage_id = (SELECT id FROM storage_locations WHERE code = 'RM-D' LIMIT 1)
WHERE current_step IN ('1', '2') AND status = 'active';

UPDATE uid_step_logs
SET closed_at = now()
WHERE step_number IN ('1', '2') AND closed_at IS NULL;

DELETE FROM jobs j
USING cycle_steps cs
WHERE j.cycle_step_id = cs.id
  AND cs.step_number IN ('1', '2')
  AND j.status IN ('queued', 'in_progress', 'paused');
