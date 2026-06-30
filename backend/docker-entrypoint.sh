#!/bin/sh
set -e

# DESTRUCTIVE, one-time: wipe the database before migrating. Use this only to
# clear a database that still holds an older backend's colliding tables. It
# defaults OFF — set RESET_DB=true in Render for a single deploy, then set it
# back to false so future deploys never wipe data.
if [ "${RESET_DB:-false}" = "true" ]; then
  echo "[entrypoint] RESET_DB=true — wiping database before migrate..."
  node scripts/reset-schema.js
fi

# Render's free tier has no Shell, so the database is bootstrapped here on boot.
# Both steps are safe to run on every deploy:
#   - migrate skips already-applied files (tracked in schema_migrations)
#   - seed guards every insert and never resets an existing admin password
# Set AUTO_MIGRATE=false to skip (e.g. once you manage migrations out-of-band).
if [ "${AUTO_MIGRATE:-true}" = "true" ]; then
  echo "[entrypoint] applying migrations..."
  node scripts/migrate.js
  echo "[entrypoint] seeding base data..."
  node seeds/seed.js
fi

# Optional sample data so a fresh install has something to click through.
# Idempotent; set SEED_DEMO=true once, then back to false. Off by default.
if [ "${SEED_DEMO:-false}" = "true" ]; then
  echo "[entrypoint] seeding demo data..."
  node seeds/demo.js
fi

# exec so node becomes PID 1 and receives Render's stop signals directly.
exec node app.js
