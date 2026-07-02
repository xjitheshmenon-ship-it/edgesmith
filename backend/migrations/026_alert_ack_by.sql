-- ============================================================================
-- 026 — Alert acknowledgement attribution
--
-- The Employee Performance report needs to attribute alert acknowledgements to
-- the person who dismissed them (a supervisor metric). Until now `dismissed_at`
-- recorded WHEN but not WHO. Add acknowledged_by so per-supervisor alert
-- responsiveness can be measured. NULL for historical/system dismissals.
-- ============================================================================
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS acknowledged_by INT REFERENCES employees(id);
