-- Rule Book §9.4 — a furnace or production batch that spans two shifts is
-- recorded against BOTH. shift_id holds the shift it started in; end_shift_id
-- holds the shift it completed in when that differs.

ALTER TABLE furnace_batches   ADD COLUMN IF NOT EXISTS end_shift_id INT REFERENCES shifts(id);
ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS end_shift_id INT REFERENCES shifts(id);
