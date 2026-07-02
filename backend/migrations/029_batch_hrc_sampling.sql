-- ============================================================================
-- 029 — Batch-level HRC sampling + recall
--
-- Type-2 HRC checking samples a % of a furnace batch and makes a whole-batch
-- decision from the results. This links inspection samples to their batch +
-- sampling round, and lets a batch be flagged as recalled.
-- ============================================================================

ALTER TABLE hrc_inspection_samples ADD COLUMN IF NOT EXISTS furnace_batch_id INT REFERENCES furnace_batches(id);
ALTER TABLE hrc_inspection_samples ADD COLUMN IF NOT EXISTS sample_round SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE furnace_batches ADD COLUMN IF NOT EXISTS recall_status VARCHAR(20);      -- NULL | 'recalled' | 'partial_warning'
ALTER TABLE furnace_batches ADD COLUMN IF NOT EXISTS recall_reason TEXT;
ALTER TABLE furnace_batches ADD COLUMN IF NOT EXISTS batch_retreatment_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_hrc_sample_batch ON hrc_inspection_samples(furnace_batch_id);
