-- MO line items: a single manufacturing order can carry several size/design
-- lines (e.g. an order for 200×1500mm Plain + 120×1424mm 9/5032). The MO keeps
-- its top-level size_id/design_id/quantity for backward compatibility (used as a
-- single-line convenience); when line items exist they are the source of truth.

CREATE TABLE IF NOT EXISTS mo_line_items (
  id          SERIAL PRIMARY KEY,
  mo_id       INT NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
  size_id     INT REFERENCES sizes(id),
  design_id   INT REFERENCES designs(id),
  quantity    INT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mo_line_items_mo ON mo_line_items(mo_id);

-- Link a UID to the specific MO line it fulfils (optional).
ALTER TABLE uids ADD COLUMN IF NOT EXISTS mo_line_item_id INT REFERENCES mo_line_items(id);
CREATE INDEX IF NOT EXISTS idx_uids_mo_line ON uids(mo_line_item_id);
