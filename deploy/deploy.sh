#!/usr/bin/env bash
#
# deploy.sh — Pull the latest code and roll it out, replacing the emailed-zip
# update flow.
#
# Steps (in order, aborting on any failure):
#   1. Back up the SQLite database first (so a bad deploy is recoverable).
#   2. `git pull --ff-only` the configured branch into the app directory.
#   3. Rebuild the frontend (the Fastify backend serves frontend/dist).
#   4. Install backend production dependencies.
#   5. Reload the pm2 process (zero-downtime) and persist the process list.
#   6. Health-check the local API and fail loudly if it does not come back.
#
# SAFETY: this script never runs `git reset --hard`, `git clean`, or any
# destructive git command, so untracked runtime files (backend/.env, the
# SQLite database under backend/data/) are left untouched. If `git pull`
# reports local changes or a non-fast-forward, it stops rather than clobbering
# anything — resolve by hand and re-run.
#
# Run on the server, from any directory, as the deploy user:
#   deploy/deploy.sh
#
# Override defaults:
#   CPCMS_APP_DIR       git working tree to pull   (default: <repo root>)
#   CPCMS_BRANCH        branch to deploy           (default: main)
#   CPCMS_BACKEND_DIR   backend dir                (default: $CPCMS_APP_DIR/backend)
#   CPCMS_FRONTEND_DIR  frontend dir               (default: $CPCMS_APP_DIR/frontend)
#   CPCMS_PM2_NAME      pm2 process name           (default: cpcms)
#   CPCMS_PORT          local app port             (default: 3001)
#   CPCMS_HEALTH_PATH   health endpoint path       (default: /api/health)
#   CPCMS_SKIP_BACKUP   set to 1 to skip the pre-deploy backup
#   CPCMS_SKIP_FRONTEND set to 1 to skip the frontend rebuild

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_DIR="${CPCMS_APP_DIR:-$REPO_ROOT}"
BRANCH="${CPCMS_BRANCH:-main}"
BACKEND_DIR="${CPCMS_BACKEND_DIR:-$APP_DIR/backend}"
FRONTEND_DIR="${CPCMS_FRONTEND_DIR:-$APP_DIR/frontend}"
PM2_NAME="${CPCMS_PM2_NAME:-cpcms}"
PORT="${CPCMS_PORT:-3001}"
HEALTH_PATH="${CPCMS_HEALTH_PATH:-/api/health}"

log() { printf '\n[deploy] %s\n' "$*"; }
die() { printf '\n[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is not installed."
command -v npm >/dev/null 2>&1 || die "npm is not installed."
command -v pm2 >/dev/null 2>&1 || die "pm2 is not installed."
[ -d "$APP_DIR/.git" ] || die "$APP_DIR is not a git working tree. Set CPCMS_APP_DIR."

# ── 1. Pre-deploy database backup ────────────────────────────────────────────
if [ "${CPCMS_SKIP_BACKUP:-0}" = "1" ]; then
  log "Skipping pre-deploy backup (CPCMS_SKIP_BACKUP=1)."
else
  log "Backing up the database before deploying..."
  CPCMS_BACKEND_DIR="$BACKEND_DIR" "$SCRIPT_DIR/backup-db.sh" \
    || die "Pre-deploy backup failed — aborting before any code change."
fi

# ── 2. Pull latest code ───────────────────────────────────────────────────────
log "Pulling '$BRANCH' into $APP_DIR ..."
cd "$APP_DIR"

# Refuse to proceed if the working tree has local modifications to TRACKED
# files — a fast-forward pull would otherwise fail halfway. (Untracked files
# like .env and the database are fine and ignored by this check.)
if ! git diff --quiet || ! git diff --cached --quiet; then
  git status --short
  die "Working tree has local changes to tracked files. Resolve them, then re-run."
fi

BEFORE="$(git rev-parse HEAD)"
git fetch origin "$BRANCH"
git pull --ff-only origin "$BRANCH" || die "git pull was not a fast-forward. Resolve by hand, then re-run."
AFTER="$(git rev-parse HEAD)"

if [ "$BEFORE" = "$AFTER" ]; then
  log "Already up to date ($AFTER). Continuing with rebuild + reload anyway."
else
  log "Updated $BEFORE -> $AFTER"
  git --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/[deploy]   /'
fi

# ── 3. Rebuild frontend ───────────────────────────────────────────────────────
if [ "${CPCMS_SKIP_FRONTEND:-0}" = "1" ]; then
  log "Skipping frontend rebuild (CPCMS_SKIP_FRONTEND=1)."
elif [ -d "$FRONTEND_DIR" ]; then
  log "Building frontend in $FRONTEND_DIR ..."
  cd "$FRONTEND_DIR"
  npm install
  npm run build
else
  log "No frontend directory at $FRONTEND_DIR — skipping frontend build."
fi

# ── 4. Backend dependencies ───────────────────────────────────────────────────
log "Installing backend production dependencies in $BACKEND_DIR ..."
cd "$BACKEND_DIR"
npm install --omit=dev

# ── 5. Reload the app ─────────────────────────────────────────────────────────
log "Reloading pm2 process '$PM2_NAME' ..."
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 reload "$PM2_NAME" --update-env
else
  log "'$PM2_NAME' not running — starting from ecosystem.config.cjs"
  pm2 start ecosystem.config.cjs
fi
pm2 save

# ── 6. Health check ───────────────────────────────────────────────────────────
HEALTH_URL="http://127.0.0.1:$PORT$HEALTH_PATH"
log "Health check: $HEALTH_URL"
OK=0
for i in 1 2 3 4 5 6; do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/tmp/cpcms-health.json 2>/dev/null; then
    OK=1
    break
  fi
  log "  attempt $i: not ready yet, retrying in 3s..."
  sleep 3
done

if [ "$OK" -eq 1 ]; then
  log "Health check passed:"
  cat /tmp/cpcms-health.json; echo
  log "Deploy complete."
else
  log "Recent pm2 logs for $PM2_NAME:"
  pm2 logs "$PM2_NAME" --lines 30 --nostream || true
  die "Health check failed after deploy. App may be down — investigate (pm2 logs $PM2_NAME)."
fi
