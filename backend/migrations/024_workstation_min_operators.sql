-- ============================================================================
-- 024 — Minimum operators per workstation
--
-- A workstation can require more than one operator on shift. min_operators is
-- the floor the Job Assignment board staffs against: a workstation is
-- "understaffed" until at least this many operators are assigned. Defaults to 1
-- (unchanged behaviour). Furnace steps run as supervisor batches and are not
-- staffed here, so their value is ignored by the board.
-- ============================================================================
ALTER TABLE workstation_types ADD COLUMN IF NOT EXISTS min_operators INT NOT NULL DEFAULT 1;
