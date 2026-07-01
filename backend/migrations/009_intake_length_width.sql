-- Structured MS (and alloy) intake geometry.
-- MS arrives as plates/sheets; recording length + width alongside weight lets
-- the floor estimate how many blocks a sheet yields. The block length itself is
-- chosen later, when MS Cutting starts, so we only capture the raw stock here.
-- The legacy free-text dimensions_mm column is kept for backward compatibility.
ALTER TABLE raw_material_intakes ADD COLUMN IF NOT EXISTS length_mm INT;
ALTER TABLE raw_material_intakes ADD COLUMN IF NOT EXISTS width_mm INT;
