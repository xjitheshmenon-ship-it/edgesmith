#!/usr/bin/env bash
#
# check-certbot.sh — Verify the Let's Encrypt certificate for CPCMS is healthy
# and that automatic renewal is working.
#
# This is a READ-ONLY health check. It does not obtain or install certificates
# and makes no changes to nginx. It:
#   1. Reports the days remaining until the certificate for the domain expires.
#   2. Runs `certbot renew --dry-run` to confirm the renewal path actually works
#      (catches a broken nginx plugin, a moved webroot, rate-limit issues, etc.).
#   3. Exits non-zero if the cert expires within the warning window OR the dry
#      run fails — so a cron job with MAILTO emails you when attention is needed.
#
# certbot's own systemd timer still does the real renewals; this just surfaces
# problems before the cert actually lapses.
#
# Usage:
#   sudo deploy/check-certbot.sh        # dry-run needs root to read /etc/letsencrypt
#
# Override defaults:
#   CPCMS_DOMAIN       domain to check           (default: cpcms.edgesmith.in)
#   CPCMS_WARN_DAYS    warn if fewer days left   (default: 21)
#   CPCMS_SKIP_DRYRUN  set to 1 to skip the renew dry-run (expiry check only)

set -euo pipefail

DOMAIN="${CPCMS_DOMAIN:-cpcms.edgesmith.in}"
WARN_DAYS="${CPCMS_WARN_DAYS:-21}"
SKIP_DRYRUN="${CPCMS_SKIP_DRYRUN:-0}"

log() { printf '[check-certbot] %s\n' "$*"; }

STATUS=0

# ── 1. Days until expiry ──────────────────────────────────────────────────────
# Prefer the installed certificate file; fall back to querying the live site.
CERT_FILE="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
END_DATE=""

if [ -r "$CERT_FILE" ]; then
  END_DATE="$(openssl x509 -enddate -noout -in "$CERT_FILE" | cut -d= -f2)"
elif command -v openssl >/dev/null 2>&1; then
  log "Cert file not readable ($CERT_FILE) — querying https://$DOMAIN instead."
  END_DATE="$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null \
    | openssl x509 -enddate -noout 2>/dev/null | cut -d= -f2 || true)"
fi

if [ -n "$END_DATE" ]; then
  END_EPOCH="$(date -d "$END_DATE" +%s 2>/dev/null || date -jf "%b %d %T %Y %Z" "$END_DATE" +%s 2>/dev/null || echo 0)"
  NOW_EPOCH="$(date +%s)"
  if [ "$END_EPOCH" -gt 0 ]; then
    DAYS_LEFT=$(( (END_EPOCH - NOW_EPOCH) / 86400 ))
    log "Certificate for $DOMAIN expires in $DAYS_LEFT day(s) ($END_DATE)."
    if [ "$DAYS_LEFT" -lt "$WARN_DAYS" ]; then
      log "WARNING: fewer than $WARN_DAYS days remaining."
      STATUS=1
    fi
  else
    log "WARNING: could not parse expiry date '$END_DATE'."
    STATUS=1
  fi
else
  log "WARNING: could not determine certificate expiry for $DOMAIN."
  STATUS=1
fi

# ── 2. Renewal dry-run ────────────────────────────────────────────────────────
if [ "$SKIP_DRYRUN" = "1" ]; then
  log "Skipping renew dry-run (CPCMS_SKIP_DRYRUN=1)."
elif ! command -v certbot >/dev/null 2>&1; then
  log "WARNING: certbot is not installed — cannot verify renewal."
  STATUS=1
else
  log "Running 'certbot renew --dry-run'..."
  if certbot renew --dry-run >/tmp/cpcms-certbot-dryrun.log 2>&1; then
    log "Renewal dry-run succeeded."
  else
    log "ERROR: 'certbot renew --dry-run' failed. Last lines:"
    tail -n 15 /tmp/cpcms-certbot-dryrun.log || true
    STATUS=1
  fi
fi

if [ "$STATUS" -eq 0 ]; then
  log "OK — certificate healthy and renewal path working."
else
  log "ATTENTION NEEDED — see warnings above."
fi
exit "$STATUS"
