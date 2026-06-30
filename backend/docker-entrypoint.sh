#!/bin/sh
set -e

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

# exec so node becomes PID 1 and receives Render's stop signals directly.
exec node app.js
