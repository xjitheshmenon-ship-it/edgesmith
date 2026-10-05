#!/usr/bin/env bash
#
# pm2-bootstrap.sh — Make the CPCMS PM2 process survive a server reboot.
#
# Two things are needed for PM2 to bring the app back automatically after a
# reboot:
#   1. `pm2 save`    — snapshot the current process list to ~/.pm2/dump.pm2
#   2. `pm2 startup` — install a systemd unit that resurrects that snapshot
#                      on boot (this step needs root; the command is printed
#                      for you to run with sudo if we cannot run it directly).
#
# Run this ONCE, on the server, as the user that owns the pm2 process
# (the same user that runs `pm2 start ecosystem.config.cjs`).
#
# Usage:
#   deploy/pm2-bootstrap.sh
#
# Override defaults:
#   CPCMS_PM2_NAME   expected process name (default: cpcms)

set -euo pipefail

PM2_NAME="${CPCMS_PM2_NAME:-cpcms}"

log() { printf '[pm2-bootstrap] %s\n' "$*"; }

if ! command -v pm2 >/dev/null 2>&1; then
  log "ERROR: pm2 is not installed or not on PATH."
  log "Install it with: sudo npm i -g pm2"
  exit 1
fi

# Warn (don't fail) if the expected process isn't running yet — save still works,
# but a reboot would bring back an empty list.
if ! pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  log "WARNING: no pm2 process named '$PM2_NAME' is currently running."
  log "Start it first, e.g.: (cd backend && pm2 start ecosystem.config.cjs)"
  log "Continuing — 'pm2 save' will snapshot whatever is running now."
fi

log "Saving current pm2 process list..."
pm2 save

log "Configuring pm2 to start on boot..."
# `pm2 startup` detects the init system and either configures it (when run as
# root) or prints the exact 'sudo env PATH=... pm2 startup ...' command to run.
if [ "$(id -u)" -eq 0 ]; then
  pm2 startup systemd -u "${SUDO_USER:-root}" --hp "$(eval echo "~${SUDO_USER:-root}")"
  pm2 save
  log "Boot startup configured."
else
  log "Not running as root. Run the command pm2 prints below with sudo, then re-run this script:"
  echo "----------------------------------------------------------------------"
  pm2 startup systemd -u "$USER" --hp "$HOME" || true
  echo "----------------------------------------------------------------------"
  log "After running that sudo command once, run: pm2 save"
fi

log "Done. Verify after a reboot with: pm2 list"
