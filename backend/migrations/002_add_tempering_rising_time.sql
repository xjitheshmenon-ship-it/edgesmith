-- Rising time = minutes to ramp the furnace up to the target temperature
-- before the soak begins. Added per cycle type × tempering step.
ALTER TABLE tempering_parameters ADD COLUMN IF NOT EXISTS rising_time_min INT;
