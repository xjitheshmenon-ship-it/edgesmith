# CPCMS — Deploying on Hostinger

Two folders, one deployment:

```
cpcms/
├── frontend/   React (Vite) — the EdgeUI2.1 console. Builds to frontend/dist.
├── backend/    Fastify API — auth, users, SQLite DB. Also serves frontend/dist.
└── HOSTINGER-DEPLOY.md
```

In production a single Node process runs everything: the backend answers `/api/*` and serves the built frontend for every other path. One PM2 process, one port.

**Note:** this needs a Hostinger **VPS** (Node.js). Hostinger shared hosting cannot run the backend.

## 1. One-time VPS setup

SSH into the VPS, then:

```bash
# Node 20 + PM2 + nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs nginx
sudo npm i -g pm2
```

## 2. Upload and build

Upload the `cpcms` folder to `/var/www/cpcms` (scp, git, or Hostinger file manager), then:

```bash
cd /var/www/cpcms/frontend && npm install && npm run build
cd /var/www/cpcms/backend  && npm install --omit=dev
cp .env.example .env && nano .env      # set JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
```

`.env` essentials:
- `JWT_SECRET` — any long random string (`openssl rand -hex 32`)
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — your first sign-in. Used only once, when the database is created.

## 3. Start it

```bash
cd /var/www/cpcms/backend
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup     # run the command it prints — survives reboots
```

The app is now live on port 3001. Check: `curl localhost:3001/api/health`

## 4. Point the domain (cpcms.edgesmith.in)

In Hostinger DNS, add an **A record**: `cpcms` → your VPS IP.

Then nginx in front:

```bash
sudo tee /etc/nginx/sites-available/cpcms << 'EOF'
server {
    listen 80;
    server_name cpcms.edgesmith.in;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF
sudo ln -s /etc/nginx/sites-available/cpcms /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS (free, auto-renewing):

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d cpcms.edgesmith.in
```

Done — https://cpcms.edgesmith.in shows the sign-in page.

## 5. Updating later

```bash
cd /var/www/cpcms/frontend && npm run build   # after replacing src/App.tsx
pm2 restart cpcms
```

The database (`backend/data/cpcms.db`) is untouched by updates. Back it up occasionally:
`cp backend/data/cpcms.db ~/cpcms-backup-$(date +%F).db`

## How login works now

- Accounts live in SQLite on the server (bcrypt-hashed passwords — nothing stored in the browser app).
- Sign-in returns a JWT valid 7 days; a page refresh restores the session automatically via `/api/auth/me`.
- Wrong password answers are rate-limited (10 tries/minute per IP).
- Admin-only API for managing users:
  - `GET /api/users` — list
  - `POST /api/users` — create (id, name, email, password, role, location)
  - `PATCH /api/users/:id` — change role/location/status (DISABLED blocks sign-in)
  - `POST /api/users/:id/reset-password`
- Quick way to add a user from your laptop until the admin screen is wired to these endpoints:

```bash
TOKEN=$(curl -s -X POST https://cpcms.edgesmith.in/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@edgesmith.in","password":"YOUR-PASSWORD"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

curl -X POST https://cpcms.edgesmith.in/api/users \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":"DHA-SUP-001","name":"Anand Rajan","email":"supervisor@edgesmith.in","password":"a-strong-password","role":"Supervisor","location":"DHARMAPURI"}'
```

Roles: Admin, Director, Supervisor, Operator. Locations: DHARMAPURI, FARIDABAD.
