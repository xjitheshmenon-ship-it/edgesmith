-- ============================================================================
-- 028 — HRC parameters + re-treatment tracking
--
-- HRC (Rockwell C) checking scores a piece against a target band per cycle type
-- and drives cycle changes: slightly-low → re-temper at a configured step,
-- very-low → external annealing (hold), high → re-temper from Tempering 1.
-- A per-cycle-type re-treatment ceiling caps how many times a UID may loop.
-- ============================================================================

CREATE TABLE IF NOT EXISTS hrc_parameters (
  cycle_type_id             INT PRIMARY KEY REFERENCES cycle_types(id),
  hrc_target_min            NUMERIC(5,2) NOT NULL,          -- inclusive band
  hrc_target_max            NUMERIC(5,2) NOT NULL,
  very_low_hrc              NUMERIC(5,2) NOT NULL,          -- below this = "very low" (anneal)
  slightly_low_retemper_step VARCHAR(5),                    -- step_number to repeat on slightly-low
  max_retreatments          INT NOT NULL DEFAULT 3,
  changed_by                INT REFERENCES employees(id),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Running count of heat-treatment re-treatments applied to a UID.
ALTER TABLE uids ADD COLUMN IF NOT EXISTS retreatment_count INT NOT NULL DEFAULT 0;

-- Seed sensible defaults per existing cycle type. slightly-low repeat step is
-- the third tempering step where present (EAT step 14), else the first temper
-- step; both are validated against the live cycle at check time regardless.
INSERT INTO hrc_parameters (cycle_type_id, hrc_target_min, hrc_target_max, very_low_hrc, slightly_low_retemper_step, max_retreatments)
SELECT ct.id, 60, 64, 50, '14', 3 FROM cycle_types ct WHERE ct.code = 'EAT'
  ON CONFLICT (cycle_type_id) DO NOTHING;
INSERT INTO hrc_parameters (cycle_type_id, hrc_target_min, hrc_target_max, very_low_hrc, slightly_low_retemper_step, max_retreatments)
SELECT ct.id, 58, 62, 48, NULL, 3 FROM cycle_types ct WHERE ct.code = 'SWAN'
  ON CONFLICT (cycle_type_id) DO NOTHING;
INSERT INTO hrc_parameters (cycle_type_id, hrc_target_min, hrc_target_max, very_low_hrc, slightly_low_retemper_step, max_retreatments)
SELECT ct.id, 56, 60, 46, NULL, 3 FROM cycle_types ct WHERE ct.code = 'OVEN'
  ON CONFLICT (cycle_type_id) DO NOTHING;
