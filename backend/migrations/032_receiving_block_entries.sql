-- ============================================================================
-- 032 — Multiple block sizes per receiving event
--
-- A single delivery from rolling can contain blocks at several post-rolling
-- sizes. block_entries stores the per-size breakdown [{size_id, count}]; the
-- existing block_count remains the total (sum) and post_rolling_size_id keeps
-- the first size for backward compatibility with single-size readers.
-- ============================================================================
ALTER TABLE receiving_events ADD COLUMN IF NOT EXISTS block_entries JSONB;
