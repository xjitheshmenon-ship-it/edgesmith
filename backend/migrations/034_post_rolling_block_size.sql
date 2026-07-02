-- ============================================================================
-- 034 — Post-rolling block size = alloy steel bar cross-section
--
-- The Master Lists "Post-Rolling Block Sizes" standard (dimension_standards
-- category 'post_rolling') had no seeded row — the 027 seed only runs on an
-- empty table, and it listed no post_rolling values. Set the post-rolling block
-- to the alloy steel bar cross-section: width 80mm, thickness 25mm. Length is
-- left as "input at point of use" (rolling elongates the block).
-- Idempotent: only inserts when no post_rolling standard exists yet.
-- ============================================================================
INSERT INTO dimension_standards (category, name, length_mm, width_mm, thickness_mm, notes)
SELECT 'post_rolling', 'Post-Rolling Block', NULL, 80, 25, 'Alloy steel bar cross-section — width 80mm, thickness 25mm'
WHERE NOT EXISTS (SELECT 1 FROM dimension_standards WHERE category = 'post_rolling');
