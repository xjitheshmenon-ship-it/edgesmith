-- Random HRC inspection sampling.
-- A cycle step can be flagged (in the Cycle Builder) to randomly sample a
-- percentage of pieces for HRC inspection after it — e.g. the straightening
-- steps that follow tempering, but not the final stress relief. On close, the
-- selected pieces are raised into an HRC inspection queue (surface grind + HRC
-- table); the piece keeps its normal cycle. hrc_sample_pct is null/0 = no sample.
ALTER TABLE cycle_steps ADD COLUMN IF NOT EXISTS hrc_sample_pct INT;

CREATE TABLE IF NOT EXISTS hrc_inspection_samples (
  id                  SERIAL PRIMARY KEY,
  uid_id              INT NOT NULL REFERENCES uids(id),
  source_step_number  VARCHAR(10),
  source_operation    VARCHAR(120),
  selected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status              VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | pass | fail
  hrc_value           NUMERIC,
  notes               TEXT,
  inspected_by        INT REFERENCES employees(id),
  inspected_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hrc_samples_pending ON hrc_inspection_samples(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_hrc_samples_uid ON hrc_inspection_samples(uid_id);
