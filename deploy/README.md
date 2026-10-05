# CPCMS server ops scripts

Operational helper scripts for the live CPCMS deployment on the Hostinger VPS
(`cpcms.edgesmith.in`). They cover routine backups, reboot survival, TLS
renewal monitoring, and a git-based deploy to replace the emailed-zip update
flow.

> **Nothing here runs automatically and nothing touches the server by itself.**
> These are proposals to review. Install the cron entries / run the scripts on
> the VPS yourself, after you're happy with them.

## Assumptions about the live server

These match the documented CPCMS production setup (see
`snapshots/cpcms-1.73/HOSTINGER-DEPLOY.md`). Every value is overridable via an
environment variable, so nothing is hard-coded to one path.

| Thing            | Default                                   | Override env var      |
|------------------|-------------------------------------------|-----------------------|
| App directory    | repo root (where `deploy/` lives)         | `CPCMS_APP_DIR`       |
| Backend dir      | `<app>/backend`                           | `CPCMS_BACKEND_DIR`   |
| Frontend dir     | `<app>/frontend`                          | `CPCMS_FRONTEND_DIR`  |
| SQLite database  | `<backend>/data/cpcms.db`                 | `CPCMS_DB_PATH`       |
| Backup directory | `<backend>/data/backups`                  | `CPCMS_BACKUP_DIR`    |
| PM2 process name | `cpcms`                                   | `CPCMS_PM2_NAME`      |
| App port         | `3001`                                    | `CPCMS_PORT`          |
| Health endpoint  | `/api/health`                             | `CPCMS_HEALTH_PATH`   |
| Domain           | `cpcms.edgesmith.in`                      | `CPCMS_DOMAIN`        |
| Deploy branch    | `main`                                    | `CPCMS_BRANCH`        |

> **Two things worth confirming before using `deploy.sh`** (noted in the PR):
> 1. The running production code is the `better-sqlite3`/Fastify app, which in
>    this repo lives under `snapshots/cpcms-1.73/`. The repo's top-level
>    `backend/` is the newer Postgres/Express rewrite. Point `CPCMS_APP_DIR` /
>    `CPCMS_BACKEND_DIR` / `CPCMS_FRONTEND_DIR` at whatever is actually checked
>    out and running at `/var/www/cpcms`, and confirm the deploy branch.
> 2. For `git pull` to work, `/var/www/cpcms` must be a git clone of this repo.
>    If it's currently an unzipped folder, we'll need a one-time switch to a
>    clone (kept out of the PR since it touches the server).

## Scripts

### `backup-db.sh` — daily SQLite backup, 14-day retention
WAL-safe online backup via `sqlite3 ".backup"` (falls back to copying
db + `-wal` + `-shm` if the `sqlite3` CLI isn't installed), gzip-compressed and
timestamped. Verifies integrity, then prunes anything older than 14 days.

```bash
deploy/backup-db.sh
```
Daily at 02:30 via crontab (`crontab -e`):
```cron
30 2 * * * /var/www/cpcms/deploy/backup-db.sh >> /var/log/cpcms-backup.log 2>&1
```

### `pm2-bootstrap.sh` — survive reboots
Runs `pm2 save` and configures `pm2 startup` (systemd) so the `cpcms` process
comes back after a reboot. Run **once**, as the user that owns the pm2 process;
the `pm2 startup` step prints a `sudo` command to run if not already root.

```bash
deploy/pm2-bootstrap.sh
```

### `check-certbot.sh` — TLS renewal monitor (read-only)
Reports days until the certificate expires and runs `certbot renew --dry-run`
to confirm renewal actually works. Exits non-zero (so cron emails you) if the
cert is within 21 days of expiry or the dry-run fails. certbot's own timer
still does the real renewals — this just warns before anything lapses.

```bash
sudo deploy/check-certbot.sh
```
Weekly check, Mondays 07:00 (root crontab, with email on failure):
```cron
MAILTO=you@edgesmith.in
0 7 * * 1 /var/www/cpcms/deploy/check-certbot.sh >> /var/log/cpcms-certbot-check.log 2>&1
```

### `deploy.sh` — git-pull deploy
Backs up the DB → `git pull --ff-only` → rebuild frontend → install backend deps
→ `pm2 reload` → health-check. Never runs destructive git commands, so `.env`
and the database are never touched. Aborts (and prints pm2 logs) if the health
check fails.

```bash
deploy/deploy.sh
```

## Safety note: protect runtime files from git

`deploy.sh` deliberately avoids `git reset --hard` / `git clean`, but the live
database (`backend/data/`), `backend/.env`, and `frontend/dist/` should be in
`.gitignore` on whatever clone runs on the server so they are never tracked or
disturbed by a pull. If they aren't already ignored there, add them — happy to
include that in a follow-up once we confirm the server's checkout layout.
