-- Certifications are skill-based (Grinding, Heat Treatment, Milling, Cutting,
-- Tagging, Coating, Inspection, Straightening) and identified by a short code,
-- rather than one badge per workstation.
ALTER TABLE badge_types ADD COLUMN IF NOT EXISTS code VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_badge_types_code ON badge_types(code) WHERE code IS NOT NULL;
