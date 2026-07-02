-- ============================================================================
-- 035 — Rename the post-rolling block standard to the alloy steel bar cross-section
--
-- The post-rolling block is already covered by the intake block standard, so the
-- 'post_rolling' reference tab is repurposed to hold the alloy steel bar's
-- width and thickness (80mm × 25mm). Rename the seeded row accordingly and make
-- sure the dimensions are set. Idempotent.
-- ============================================================================
UPDATE dimension_standards
SET name = 'Alloy Steel Bar', width_mm = 80, thickness_mm = 25,
    notes = 'Alloy steel bar — width 80mm, thickness 25mm'
WHERE category = 'post_rolling' AND name = 'Post-Rolling Block';

-- If the row never existed (e.g. category was empty), seed it now.
INSERT INTO dimension_standards (category, name, length_mm, width_mm, thickness_mm, notes)
SELECT 'post_rolling', 'Alloy Steel Bar', NULL, 80, 25, 'Alloy steel bar — width 80mm, thickness 25mm'
WHERE NOT EXISTS (SELECT 1 FROM dimension_standards WHERE category = 'post_rolling');
