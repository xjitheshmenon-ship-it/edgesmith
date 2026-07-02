-- ============================================================================
-- 025 — Optional maximum operators per workstation
--
-- Complements 024 (min_operators). max_operators is an OPTIONAL ceiling: when
-- set, the Work Assignment board warns (but never blocks) once a workstation is
-- staffed above it. NULL = no ceiling (the default).
-- ============================================================================
ALTER TABLE workstation_types ADD COLUMN IF NOT EXISTS max_operators INT;
