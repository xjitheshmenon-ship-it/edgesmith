-- ============================================================================
-- 023 — Receiving & Intake page support
--
-- Adds the dedicated Master List tables the unified Receiving & Intake page
-- depends on (alloy bar profiles, alloy bar lengths, MS sheet sizes), lets a
-- raw-material intake carry a STRUCTURED ARRAY of bar/sheet entries (multiple
-- lengths/sizes in one delivery, each with its own quantity + auto weight), and
-- extends receiving_events with the post-rolling size and colour-mismatch note.
-- ============================================================================

-- ── Alloy bar profiles (width × thickness fixed per profile) ────────────────
CREATE TABLE IF NOT EXISTS alloy_bar_profiles (
  id            SERIAL PRIMARY KEY,
  label         VARCHAR(40),                 -- optional display label; auto-derived if blank
  width_mm      INT NOT NULL,
  thickness_mm  INT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_bar_profile UNIQUE (width_mm, thickness_mm)
);

-- ── Alloy bar lengths (selectable per bar entry) ────────────────────────────
CREATE TABLE IF NOT EXISTS alloy_bar_lengths (
  id            SERIAL PRIMARY KEY,
  length_mm     INT NOT NULL UNIQUE,
  label         VARCHAR(40),
  status        VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── MS sheet sizes (length × width, height/thickness fixed per size) ────────
CREATE TABLE IF NOT EXISTS ms_sheet_sizes (
  id            SERIAL PRIMARY KEY,
  label         VARCHAR(40),
  length_mm     INT NOT NULL,
  width_mm      INT NOT NULL,
  height_mm     INT NOT NULL,               -- thickness — auto-filled at intake, never typed
  status        VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_sheet_size UNIQUE (length_mm, width_mm, height_mm)
);

-- ── raw_material_intakes: structured entries + profile/thickness ────────────
ALTER TABLE raw_material_intakes ADD COLUMN IF NOT EXISTS entries JSONB;          -- [{length_mm,width_mm,height_mm,thickness_mm,quantity,weight_kg,...}]
ALTER TABLE raw_material_intakes ADD COLUMN IF NOT EXISTS thickness_mm INT;
ALTER TABLE raw_material_intakes ADD COLUMN IF NOT EXISTS profile_id INT REFERENCES alloy_bar_profiles(id);

-- ── receiving_events: post-rolling size + mismatch note ─────────────────────
ALTER TABLE receiving_events ADD COLUMN IF NOT EXISTS post_rolling_size_id INT REFERENCES sizes(id);
ALTER TABLE receiving_events ADD COLUMN IF NOT EXISTS mismatch_note TEXT;
ALTER TABLE receiving_events ADD COLUMN IF NOT EXISTS mismatch_confirmed_by INT REFERENCES employees(id);

-- ── Seed the current standard profile + common lengths / sheet sizes ────────
-- (guarded by ON CONFLICT so re-running the migration is harmless.)
INSERT INTO alloy_bar_profiles (label, width_mm, thickness_mm) VALUES
  ('80mm × 25mm', 80, 25)
  ON CONFLICT (width_mm, thickness_mm) DO NOTHING;

INSERT INTO alloy_bar_lengths (length_mm, label) VALUES
  (1500, '1500mm'), (2750, '2750mm'), (3000, '3000mm')
  ON CONFLICT (length_mm) DO NOTHING;

INSERT INTO ms_sheet_sizes (label, length_mm, width_mm, height_mm) VALUES
  ('2000 × 1000 × 80', 2000, 1000, 80),
  ('1500 × 800 × 80',  1500, 800,  80),
  ('3000 × 1200 × 80', 3000, 1200, 80)
  ON CONFLICT (length_mm, width_mm, height_mm) DO NOTHING;
