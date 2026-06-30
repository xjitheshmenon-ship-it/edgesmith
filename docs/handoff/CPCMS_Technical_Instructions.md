# CPCMS — Technical Architecture Instructions
## Frontend, Backend, and System Operations
## Edgesmith Tooling India Pvt Ltd

---

## SYSTEM OVERVIEW

CPCMS runs as two separate applications — a frontend and a backend — deployed on a single cloud server. Both Faridabad and Dharmapuri access the system over the internet. No local servers. No VPN. No on-premise hardware beyond user devices.

```
┌──────────────────────────────────────────────────────────┐
│                    INTERNET                              │
│                                                          │
│  Faridabad devices ──────────────────────────────────┐  │
│  (desktops, tablets, phones)                         │  │
│                                                      ▼  │
│  Dharmapuri devices ──────────────► cpcms.edgesmith.in  │
│  (desktops, tablets, phones)          (Hetzner Cloud)   │
│                                                      │  │
│  Shopfloor wall screens ─────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘

                    cpcms.edgesmith.in
          ┌─────────────────────────────────┐
          │          Hetzner CPX31          │
          │                                 │
          │  nginx (port 80/443)            │
          │    ├── serves frontend files    │
          │    └── proxies /api/* calls     │
          │                                 │
          │  Node.js backend (port 3001)    │
          │    └── REST API + business logic│
          │                                 │
          │  PostgreSQL (port 5432)         │
          │    └── all application data     │
          └─────────────────────────────────┘
```

---

## CLOUD SERVER

### Provider

**Hetzner Cloud** — most cost-effective option for this scale with excellent reliability.
Hetzner pricing is approximately one third of AWS or Google Cloud for equivalent specs.

### Server specification

**Plan: CPX31**

> Note: If Hetzner Bangalore (IN-BLR) is not yet available at the time of deployment, use Hetzner Helsinki (EU-FI) as fallback — same price, same specs, slightly higher latency from India (~120ms vs ~10ms)
- 4 vCPU (AMD)
- 8 GB RAM
- 160 GB NVMe SSD
- 20 TB traffic per month
- Cost: approximately €13–15 per month (~₹1,200–1,400/month)
- Location: Bangalore, India (IN-BLR) — data stays in India, lowest latency for both factories

This handles:
- 12,000 active UIDs and their step history
- 30+ concurrent users
- Real-time polling every 30 seconds from all connected devices
- PostgreSQL database with full audit history

Scale up to CPX41 (8 vCPU, 16 GB RAM, ~€28/month) if performance degrades over time as data grows.

### Operating system

Ubuntu 22.04 LTS — long-term support until 2027, well documented, widely supported.

---

## DOMAIN SETUP

System runs on: **cpcms.edgesmith.in**

### DNS configuration

In the edgesmith.in DNS settings (wherever the domain is managed — GoDaddy, Cloudflare, etc.), add:

```
Type    Name     Value                  TTL
A       cpcms    <Hetzner server IP>    300
```

This points cpcms.edgesmith.in to the Hetzner server.

### SSL certificate

Use Let's Encrypt — free, auto-renews every 90 days.

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d cpcms.edgesmith.in
# Follow prompts — certbot auto-configures nginx for HTTPS
# Auto-renewal is set up automatically by certbot
```

---

## DEVICE SUPPORT AND RESPONSIVE DESIGN

Users access the system from three device types. The frontend must work well on all three.

### Desktop computers
- Primary device for Managers and Admins
- Full sidebar visible, all columns in tables visible
- Keyboard shortcuts supported (/ for global search, Escape to close modals)
- Minimum supported resolution: 1280 × 720

### Tablets (Android and iPad)
- Primary device for Supervisors on the floor
- Sidebar collapses to icon-only by default on tablet width
- Tables scroll horizontally on narrow screens
- Touch-friendly tap targets (minimum 44px height on all buttons)
- Minimum supported width: 768px

### Mobile phones
- Used by Operators for quick step completion and QC logging
- Sidebar hidden by default, opens as overlay on hamburger tap
- Simplified layout: one column, stacked cards instead of tables
- Large tap targets — operators may be wearing gloves
- Minimum supported width: 375px
- Operator's "My Jobs" page is the primary mobile view — optimised for one-handed use

### Shopfloor wall display
- Any browser in full-screen mode (F11 or kiosk mode)
- Designed for viewing from 2–3 metres distance — large text, high contrast
- Auto-refreshes every 30 seconds without user interaction
- No interaction required — display only

### Responsive breakpoints

```
Mobile:   < 768px   — single column, hamburger nav, stacked cards
Tablet:   768–1199px — icon sidebar, condensed tables
Desktop:  ≥ 1200px  — full sidebar, full tables
```

---

## OFFLINE BEHAVIOUR

If the cloud server is unreachable (user's internet goes down):

- Frontend detects failed API calls after 2 retries
- Status bar at bottom turns red and shows: "Connection lost — changes cannot be saved"
- All form submit buttons are disabled
- Data already loaded on screen remains visible (read-only)
- Auto-retry every 30 seconds
- When connection restores: status bar turns green, buttons re-enable, data auto-refreshes

No offline data sync is built. All data operations require a live connection to the server.

---

## FRONTEND

### What it is

A single-page application (SPA) served as static HTML, CSS, and JavaScript files. Runs entirely in the browser. Makes API calls to the backend for all data. Has no direct database access.

### Technology choice

Claude Code decides the specific framework. Requirements:
- Modern component-based SPA (React, Vue, or Svelte)
- Client-side routing
- Real-time data via polling (every 30 seconds on live pages)
- Fully responsive — mobile, tablet, desktop
- Builds to static files served by nginx

### What the frontend handles

- All UI rendering across all 20 pages
- Responsive layout per device type
- Client-side routing without full page reloads
- JWT token storage (httpOnly cookie — not localStorage)
- Role-based UI — pages, sections, and actions shown based on role and location
- Client-side form validation before API submission
- Polling every 30 seconds on: Production Floor, Shopfloor Display, Dashboard stats, active furnace batches
- Connection state monitoring and offline message
- Local user preferences in localStorage: sidebar state, location filter
- Printable UID list generation from UID Creation page
- Global search with keyboard shortcut

### What the frontend does NOT handle

- Business logic — all rules enforced by backend
- Data persistence — nothing critical in browser
- Authentication decisions — backend validates every request independently

### Frontend folder structure

```
/frontend
  /src
    /components        — reusable UI components
      /common          — buttons, tables, badges, modals, alerts
      /layout          — topbar, sidebar, status bar, shell
      /forms           — form fields, validation wrappers
      /charts          — report charts and graphs
    /pages
      /dashboard
      /faridabad
        /intake
        /joining
        /dispatch
      /dharmapuri
        /receiving
        /uid-creation
        /floor
        /batch
        /qc
      /management
        /mo-linking
        /shifts
        /jobs
        /reports
      /service
        /lookup
      /admin
        /cycle-builder
        /master-lists
        /tempering
        /employees
        /users
    /layouts            — shell layout (topbar, sidebar, status bar)
    /hooks              — data fetching hooks per resource
    /store              — global state (user, location, active shift, alerts)
    /api                — API client, one file per resource group
    /utils              — formatters, UID helpers, date helpers
    /responsive         — breakpoint hooks, mobile-specific components
  /public               — favicon, logo, manifest
  .env.production
  .env.development
```

### Frontend environment variables

```
VITE_API_BASE_URL=https://cpcms.edgesmith.in
VITE_POLLING_INTERVAL_MS=30000
VITE_APP_VERSION=1.0.0
VITE_OFFLINE_RETRY_MS=30000
```

### Frontend build and deploy

```bash
# Install
npm install

# Development
npm run dev
# Runs on http://localhost:5173, proxies /api to backend

# Production build
npm run build
# Outputs static files to /dist — copy to server

# Deploy to server
rsync -av dist/ user@cpcms.edgesmith.in:/var/www/cpcms/frontend/
```

---

## BACKEND

### What it is

A REST API server running on the cloud server. Receives HTTPS requests from the frontend, applies business logic, reads and writes to PostgreSQL, and returns JSON. Stateless — no server-side sessions. Auth via JWT.

### Technology choice

Claude Code decides framework and language. Requirements:
- REST API with JSON request and response bodies
- JWT middleware
- PostgreSQL driver
- Background job scheduler (cron-style, built-in to the process)
- Deployable as a long-running process under PM2
- Must handle 30+ concurrent connections without issues

### What the backend handles

- Authentication — issue and validate JWT tokens
- Authorisation — role and location check on every endpoint
- All business logic:
  - UID series management and auto-generation
  - Design lock at Steps 15 and 16
  - Step capacity checks before assigning
  - Badge validation before workstation assignment
  - Scrap calculation at Converting
  - Child UID creation at Converting
  - Furnace deviation flagging against Admin-configured tolerances
  - Cycle version management
  - Hold and release logic
  - Shift auto-start at configured times
- All database reads and writes
- Background jobs (runs inside the backend process):
  - Every minute: check if new shift should start, auto-create shift record
  - Every hour: check employee badge expiry, create alerts
  - Every 5 minutes: check overdue receiving events
- Audit log — every write records user, timestamp, before value, after value
- Alert generation and routing

### Backend folder structure

```
/backend
  /src
    /routes             — API routes, one file per resource group
    /controllers        — business logic per resource
    /middleware
      auth.js           — JWT verification
      rbac.js           — role and location permission checks
      audit.js          — audit log writer
      rateLimiter.js    — prevent abuse
    /models             — database query functions (raw SQL or query builder)
    /jobs               — background job definitions
      shiftStart.js
      badgeExpiry.js
      overdueReceiving.js
    /utils
      uidGenerator.js
      scrapCalculator.js
      deviationChecker.js
      cycleVersioning.js
    /config
      database.js
      jwt.js
      shifts.js
  app.js                — server entry point
  .env                  — production secrets (not in git)
  package.json
  /migrations           — numbered SQL migration files
  /seeds                — initial data (admin user, shift config, workstations)
```

### Backend environment variables

```
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://cpcms_user:STRONG_PASSWORD@localhost:5432/cpcms_db
JWT_SECRET=LONG_RANDOM_STRING_MIN_64_CHARS
JWT_EXPIRES_IN=8h
SHIFT_1_START=06:00
SHIFT_2_START=14:00
SHIFT_3_START=22:00
CORS_ALLOWED_ORIGIN=https://cpcms.edgesmith.in
LOG_LEVEL=info
BACKUP_PATH=/var/backups/cpcms
```

---

## DATABASE

### Engine

PostgreSQL 14+ running on the same Hetzner server as the backend.

### Connection

Backend connects to PostgreSQL on localhost (not exposed to internet). PostgreSQL binds to 127.0.0.1 only — firewall blocks port 5432 from outside.

### Key tables

```
-- Reference / master data
locations
workstation_types
workstation_units
employees
badge_types
employee_badges
shifts_config
products
sizes
designs
suppliers
contractors
conversion_patterns
storage_locations

-- Cycle configuration (versioned)
cycle_types
cycle_versions
cycle_steps
step_capacity

-- Faridabad operations
raw_material_intakes
joining_batches
contractor_dispatches

-- Dharmapuri operations
receiving_events
uids                    — 12,000+ active rows
uid_step_logs           — high volume, grows continuously
furnace_batches
furnace_batch_uids
production_batches
split_events

-- Work management
shifts
shift_handovers
jobs
alerts

-- Orders and audit
manufacturing_orders
audit_log               — append-only, never deleted
```

### Critical indexes

```sql
-- uids — queried constantly by status, step, storage, priority
CREATE INDEX idx_uids_status        ON uids(status);
CREATE INDEX idx_uids_current_step  ON uids(current_step);
CREATE INDEX idx_uids_storage       ON uids(current_storage);
CREATE INDEX idx_uids_priority      ON uids(priority);
CREATE INDEX idx_uids_cycle         ON uids(cycle_version_id);
CREATE INDEX idx_uids_mo            ON uids(mo_id);
CREATE INDEX idx_uids_location      ON uids(location_id);

-- uid_step_logs — very high volume over time
CREATE INDEX idx_step_logs_uid      ON uid_step_logs(uid_id);
CREATE INDEX idx_step_logs_step     ON uid_step_logs(step_number);
CREATE INDEX idx_step_logs_shift    ON uid_step_logs(shift_id);

-- jobs — queried per shift and per operator
CREATE INDEX idx_jobs_shift         ON jobs(shift_id);
CREATE INDEX idx_jobs_operator      ON jobs(operator_id);
CREATE INDEX idx_jobs_status        ON jobs(status);

-- furnace_batch_uids
CREATE INDEX idx_fbu_batch          ON furnace_batch_uids(batch_id);
CREATE INDEX idx_fbu_uid            ON furnace_batch_uids(uid_id);

-- alerts — queried per user and location
CREATE INDEX idx_alerts_location    ON alerts(location_id);
CREATE INDEX idx_alerts_status      ON alerts(status);
```

---

## API STRUCTURE

### Base URL

```
https://cpcms.edgesmith.in/api/v1
```

### Authentication

Every request except POST /auth/login must include JWT in cookie (httpOnly, secure, sameSite=strict). Backend sets the cookie on login. Browser sends it automatically on every request.

Token lifetime: 8 hours. Frontend silently refreshes token when less than 30 minutes remain.

### Standard response format

```json
// Success
{
  "success": true,
  "data": { ... },
  "meta": { "total": 1200, "page": 1, "per_page": 50 }
}

// Error
{
  "success": false,
  "error": {
    "code": "DESIGN_NOT_CONFIRMED",
    "message": "UID E043 cannot proceed — design not confirmed",
    "details": { "uid": "E043", "step": 15 }
  }
}
```

### All API endpoints

```
-- Auth
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout

-- UIDs
GET    /uids                        — list (filters: status, step, storage, cycle, priority, location)
POST   /uids                        — bulk create
GET    /uids/:code                  — full detail with step history
PATCH  /uids/:code                  — update (priority, design, MO, hold)
POST   /uids/:code/advance          — mark step complete
POST   /uids/:code/hold             — place hold with reason
POST   /uids/:code/release          — release hold
POST   /uids/:code/converting       — trigger Step 16 Converting
GET    /uids/:code/lineage          — parent, children, siblings
GET    /uids/summary/wip            — count per storage (dashboard)
GET    /uids/summary/stations       — count per workstation (dashboard + floor)

-- Step logs
POST   /steps/:uid_code/log         — log QC measurement

-- Furnace batches
GET    /furnace-batches
POST   /furnace-batches
GET    /furnace-batches/:id
PATCH  /furnace-batches/:id/complete — log actuals, close batch
GET    /furnace-batches/:id/uids

-- Production batches (non-furnace)
GET    /batches
POST   /batches
PATCH  /batches/:id/complete

-- Cycles
GET    /cycles
POST   /cycles
GET    /cycles/:id/steps
PUT    /cycles/:id/steps            — update steps, creates new version
GET    /cycles/:id/versions
POST   /cycles/import
GET    /cycles/:id/export

-- Shifts
GET    /shifts/current
GET    /shifts
POST   /shifts/:id/handover
POST   /shifts/:id/acknowledge

-- Job assignment
GET    /jobs                        — current shift jobs
POST   /jobs/auto-assign
POST   /jobs
PATCH  /jobs/:id
DELETE /jobs/:id                    — return to unassigned queue

-- Alerts
GET    /alerts
PATCH  /alerts/:id/dismiss

-- Faridabad
GET    /faridabad/intakes
POST   /faridabad/intakes
GET    /faridabad/joinings
POST   /faridabad/joinings
GET    /faridabad/dispatches
POST   /faridabad/dispatches

-- Dharmapuri receiving
GET    /receiving
POST   /receiving
GET    /receiving/:id

-- Manufacturing orders
GET    /mos
POST   /mos
PATCH  /mos/:id
POST   /mos/:id/link-uids

-- QC
GET    /qc/pending                  — UIDs awaiting QC sign-off
POST   /qc/sign-off                 — supervisor signs off
POST   /qc/log                      — operator logs measurement
POST   /qc/rework                   — send UID back to earlier step

-- Employees and badges
GET    /employees
POST   /employees
PATCH  /employees/:id
GET    /employees/:id/badges
POST   /employees/:id/badges
DELETE /employees/:id/badges/:badge_id

-- Reports (all return JSON data, frontend renders charts)
GET    /reports/production
GET    /reports/wip
GET    /reports/furnace
GET    /reports/scrap
GET    /reports/mo-fulfilment
GET    /reports/quality
GET    /reports/traceability
GET    /reports/shift
GET    /reports/capacity

-- Service lookup (restricted to Service role)
GET    /service/uid/:code

-- Master lists
GET/POST/PATCH/DELETE  /master/workstation-types
GET/POST/PATCH/DELETE  /master/workstation-units
GET/POST/PATCH/DELETE  /master/products
GET/POST/PATCH/DELETE  /master/sizes
GET/POST/PATCH/DELETE  /master/designs
GET/POST/PATCH/DELETE  /master/suppliers
GET/POST/PATCH/DELETE  /master/contractors
GET/POST/PATCH/DELETE  /master/conversion-patterns
GET/POST/PATCH/DELETE  /master/storage-locations

-- Admin
GET/PATCH  /admin/tempering-params
GET/POST/PATCH/DELETE  /admin/users
GET        /admin/audit-log
GET        /admin/shift-config
PATCH      /admin/shift-config

-- Health
GET        /health
```

---

## DEPLOYMENT — COMPLETE STEP BY STEP

### Step 1 — Create Hetzner server

1. Create account at hetzner.com/cloud
2. Create new project: "CPCMS Edgesmith"
3. Add server:
   - Location: Bangalore, India (IN-BLR) — data stays in India, lowest latency for Faridabad and Dharmapuri
   - Image: Ubuntu 22.04
   - Type: CPX31 (4 vCPU, 8 GB RAM, 160 GB SSD)
   - Add your SSH public key during setup
   - Name: cpcms-production
4. Note the server's public IP address

### Step 2 — Point domain to server

In the DNS management panel for edgesmith.in, add:
```
Type: A
Name: cpcms
Value: <Hetzner server IP>
TTL: 300
```

Wait 5–30 minutes for DNS to propagate.

### Step 3 — Initial server setup

```bash
# SSH into server
ssh root@cpcms.edgesmith.in

# Update system
apt update && apt upgrade -y

# Create non-root user for running the app
adduser cpcms
usermod -aG sudo cpcms

# Set up firewall — allow only SSH, HTTP, HTTPS
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw deny 5432          # block PostgreSQL from internet
ufw enable

# Switch to app user
su - cpcms
```

### Step 4 — Install software dependencies

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL 14
sudo apt install -y postgresql postgresql-contrib

# nginx
sudo apt install -y nginx

# Certbot for SSL
sudo apt install -y certbot python3-certbot-nginx

# PM2
sudo npm install -g pm2

# Verify installs
node --version    # should be v20.x
psql --version    # should be 14.x
nginx -v
```

### Step 5 — Set up PostgreSQL

```bash
sudo -u postgres psql

CREATE DATABASE cpcms_db;
CREATE USER cpcms_user WITH PASSWORD 'USE_A_STRONG_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON DATABASE cpcms_db TO cpcms_user;
\q

# Verify connection
psql -U cpcms_user -d cpcms_db -h localhost
```

### Step 6 — Deploy backend

```bash
# Create app directory
sudo mkdir -p /var/www/cpcms/backend
sudo chown cpcms:cpcms /var/www/cpcms/backend

# Copy backend files to server (run from your local machine)
rsync -av ./backend/ cpcms@cpcms.edgesmith.in:/var/www/cpcms/backend/

# On the server
cd /var/www/cpcms/backend
npm install --production

# Create environment file
nano .env
# Paste and fill in all environment variables:
# NODE_ENV=production
# PORT=3001
# DATABASE_URL=postgresql://cpcms_user:YOUR_PASSWORD@localhost:5432/cpcms_db
# JWT_SECRET=GENERATE_WITH: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# JWT_EXPIRES_IN=8h
# SHIFT_1_START=06:00
# SHIFT_2_START=14:00
# SHIFT_3_START=22:00
# CORS_ALLOWED_ORIGIN=https://cpcms.edgesmith.in
# LOG_LEVEL=info

# Run database migrations
npm run migrate

# Run seed data (admin user, default config, workstations)
npm run seed

# Start with PM2
pm2 start ecosystem.config.js
pm2 startup          # sets PM2 to start on server reboot
pm2 save
```

### Step 7 — Deploy frontend

```bash
# Build on your local machine
cd frontend
npm install
npm run build
# creates /dist folder

# Copy to server
rsync -av dist/ cpcms@cpcms.edgesmith.in:/var/www/cpcms/frontend/
```

### Step 8 — Configure nginx

```bash
sudo nano /etc/nginx/sites-available/cpcms
```

Paste:

```nginx
server {
    listen 80;
    server_name cpcms.edgesmith.in;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name cpcms.edgesmith.in;

    # SSL — filled in by certbot
    ssl_certificate /etc/letsencrypt/live/cpcms.edgesmith.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cpcms.edgesmith.in/privkey.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    add_header Referrer-Policy "strict-origin-when-cross-origin";

    # Serve frontend static files
    root /var/www/cpcms/frontend;
    index index.html;

    # SPA routing — serve index.html for all unknown paths
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API calls to backend
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }

    # Cache static assets aggressively
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    gzip_min_length 1000;
}
```

```bash
# Enable site and get SSL certificate
sudo ln -s /etc/nginx/sites-available/cpcms /etc/nginx/sites-enabled/
sudo nginx -t                           # test config — must say "ok"
sudo certbot --nginx -d cpcms.edgesmith.in   # get SSL cert, auto-configures nginx
sudo systemctl restart nginx
```

### Step 9 — Set up automated database backups

```bash
# Create backup directory
sudo mkdir -p /var/backups/cpcms
sudo chown cpcms:cpcms /var/backups/cpcms

# Create backup script
nano /home/cpcms/backup.sh
```

Paste:
```bash
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/var/backups/cpcms/cpcms_${TIMESTAMP}.sql.gz"
pg_dump -U cpcms_user -d cpcms_db | gzip > $BACKUP_FILE
echo "Backup created: $BACKUP_FILE"
# Delete backups older than 30 days
find /var/backups/cpcms -name "cpcms_*.sql.gz" -mtime +30 -delete
```

```bash
chmod +x /home/cpcms/backup.sh

# Add to crontab
crontab -e
# Add these lines:
# Daily backup at 2:00 AM
0 2 * * * /home/cpcms/backup.sh >> /var/log/cpcms-backup.log 2>&1
```

### Step 10 — Verify everything works

```bash
# Check backend is running
pm2 status
pm2 logs cpcms-backend --lines 20

# Check health endpoint
curl https://cpcms.edgesmith.in/api/v1/health
# Should return: {"success":true,"status":"ok","database":"connected"}

# Check frontend loads
# Open https://cpcms.edgesmith.in in a browser
# Should show CPCMS login page

# Check SSL certificate
curl -I https://cpcms.edgesmith.in
# Should show HTTP/2 200 with valid SSL headers
```

---

## UPDATING THE SYSTEM (zero downtime)

Run from your local development machine:

```bash
# 1. Build new frontend
cd frontend
npm run build

# 2. Deploy frontend (instant — static files replaced)
rsync -av dist/ cpcms@cpcms.edgesmith.in:/var/www/cpcms/frontend/

# 3. Deploy backend
rsync -av ./backend/ cpcms@cpcms.edgesmith.in:/var/www/cpcms/backend/ \
  --exclude node_modules \
  --exclude .env

# 4. On the server — install new dependencies and migrate
ssh cpcms@cpcms.edgesmith.in
cd /var/www/cpcms/backend
npm install --production
npm run migrate              # safe on existing data — only adds new tables/columns

# 5. Reload backend (PM2 cluster mode — zero downtime)
pm2 reload cpcms-backend

# 6. Verify
curl https://cpcms.edgesmith.in/api/v1/health
```

---

## PM2 CONFIGURATION

```javascript
// /var/www/cpcms/backend/ecosystem.config.js
module.exports = {
  apps: [{
    name: 'cpcms-backend',
    script: 'app.js',
    cwd: '/var/www/cpcms/backend',
    instances: 2,
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '1G',
    env: { NODE_ENV: 'production' },
    log_file: '/var/log/cpcms-backend.log',
    error_file: '/var/log/cpcms-backend-error.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};
```

---

## MONITORING AND HEALTH

### Health check endpoint

```
GET https://cpcms.edgesmith.in/api/v1/health
```

Returns:
```json
{
  "success": true,
  "status": "ok",
  "database": "connected",
  "uptime_seconds": 86400,
  "active_uids": 11847,
  "version": "1.0.0"
}
```

### Useful PM2 commands

```bash
pm2 status                      — show all processes and their status
pm2 logs cpcms-backend          — tail live logs
pm2 logs cpcms-backend --lines 100  — last 100 log lines
pm2 reload cpcms-backend        — zero-downtime restart
pm2 restart cpcms-backend       — hard restart (brief downtime)
pm2 monit                       — live CPU and memory dashboard
```

### Disk space monitoring

```bash
df -h                           — check disk usage
du -sh /var/backups/cpcms       — backup folder size
du -sh /var/lib/postgresql      — database size
```

If disk reaches 80%: upgrade to Hetzner CPX41 (additional 160 GB) or add a Hetzner Volume (block storage, €0.05/GB/month).

---

## SECURITY

### What is exposed to the internet

Only ports 80 (redirects to 443) and 443 (HTTPS). Everything else blocked by UFW firewall.
PostgreSQL runs on localhost only — not reachable from internet.
Backend runs on port 3001 — only reachable from nginx on the same server.

### JWT authentication

- JWT stored in httpOnly, Secure, SameSite=Strict cookie
- Never stored in localStorage or JavaScript-accessible memory
- 8-hour expiry (one full shift)
- Silent refresh when less than 30 minutes remain
- Logout clears cookie immediately

### Authorisation on every API request

Every endpoint checks:
1. Is the JWT valid and not expired?
2. Does the user's role have permission for this action?
3. Does the request data belong to the user's assigned location?

Backend enforces location scoping independently — frontend location filter is for UX only, backend never trusts it.

### Input validation

All API inputs validated on backend before any database operation.
UID codes validated against format before lookup.
Parameterised queries prevent SQL injection.

### Audit log

Every data write (INSERT, UPDATE, DELETE) records: user ID, timestamp, table, record ID, before value, after value. Audit log is append-only and never deleted.

---

## WHAT CLAUDE CODE MUST DELIVER

Three folders, deployable to cpcms.edgesmith.in:

**`/frontend`**
Complete responsive SPA — all 20 pages, works on mobile/tablet/desktop, role-based navigation, 30-second polling on live pages, offline state handling. Build command: `npm run build` outputs static files to `/dist`.

**`/backend`**
Complete REST API — all endpoints listed above, JWT cookie auth, RBAC middleware, all business logic, background jobs, database migrations, seed data. Start command: `npm start`. Health endpoint at `/api/v1/health`.

**`/docs/api.md`**
API reference — every endpoint, required role, request body, response shape. Enough for frontend and backend to be developed independently.

**`README.md`** at project root:
- Local development setup (both apps)
- All environment variables for frontend and backend
- Complete deployment steps referencing this document
- How to run database migrations
- How to update the system

