-- Master Lists: note on each size whether it denotes raw material, a job
-- (work-in-process piece) or a final product.
ALTER TABLE sizes ADD COLUMN IF NOT EXISTS material_role VARCHAR(20);   -- raw_material | job | final_product
