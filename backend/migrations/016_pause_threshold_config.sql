-- Rule Book §6 — Admin configures a maximum acceptable pause duration per step.
-- If a job stays paused beyond this many minutes the on-duty supervisor is
-- alerted (see src/jobs/pauseThreshold.js). NULL means no limit for that step.

ALTER TABLE cycle_steps ADD COLUMN IF NOT EXISTS max_pause_minutes INT;
