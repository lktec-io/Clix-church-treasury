# Deployment — Contabo Production Guide

**Status: the codebase is deployment-ready. Nothing below has actually been executed** — this is a step-by-step guide to follow, not a record of what's already been done. See [MASTER_TODO.md](MASTER_TODO.md) for what live-verification is still PENDING and why (no server/MySQL access in the build environment).

**Fixed production configuration for this deployment — do not deviate:**

| | |
|---|---|
| Domain | `https://treasurer.clixworks.co.tz` |
| API base | `https://treasurer.clixworks.co.tz/api/v1` |
| Backend port | `4005` (never `4000`) |
| Database name | `treasurer` |
| Database user | `root` (see §R.1 for the optional least-privilege alternative — not required) |
| Database port | `3306` |

Target host: a single Contabo VPS running the Node backend (via PM2), MySQL 8, and Nginx (reverse proxy + static frontend serving).

Repository URL below is a placeholder — `<YOUR_GITHUB_REPO_URL>` — substitute your actual GitHub URL once the repository is pushed; this document does not invent one.

---

## A. VPS Prerequisites

A Contabo VPS with:
- Ubuntu 22.04 LTS (or similar) with root or sudo access
- A public IPv4 address
- Ports 80 and 443 reachable from the internet (443 for HTTPS traffic; 80 only redirects to it)
- Port 4005 does **not** need to be publicly reachable — it's only proxied internally by Nginx (see §M)

```sh
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential
```

---

## B. Node.js

This project targets a current Node LTS. Install via NodeSource:

```sh
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # confirm v20.x
npm -v
```

Install PM2 globally:

```sh
sudo npm install -g pm2
```

---

## C. MySQL

```sh
sudo apt install -y mysql-server
sudo mysql_secure_installation   # sets/confirms the root password interactively — do this now
```

This deployment uses the `root` MySQL user directly (see the fixed configuration table above, and §18/§R.1 for why and the optional alternative). Note the root password you set here — it goes into `server/.env` in §F, nowhere else.

---

## D. Git

Already installed via §A. Confirm:
```sh
git --version
```

---

## E. Clone the Repository

```sh
cd /var/www
sudo git clone <YOUR_GITHUB_REPO_URL> clix-treasury
sudo chown -R $USER:$USER clix-treasury
cd clix-treasury
```

---

## F. Backend Environment

```sh
cd server
cp .env.example .env
nano .env   # or your editor of choice
```

Fill in, per the fixed configuration table above:

```
NODE_ENV=production
PORT=4005

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=<the root password you set in §C — never committed, never asked for by anyone>
DB_NAME=treasurer

JWT_ACCESS_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30

LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
PASSWORD_RESET_TTL_MINUTES=30

FRONTEND_URL=https://treasurer.clixworks.co.tz
CORS_ORIGINS=https://treasurer.clixworks.co.tz
```

`DB_NAME_TEST` is not needed in production (only read when `NODE_ENV=test`). There is no `JWT_REFRESH_SECRET` — refresh tokens are opaque random values, not JWTs; don't add one.

Install dependencies:
```sh
npm ci --omit=dev
```

---

## G. Database Creation

```sh
mysql -u root -p < scripts/setup-db.production.example.sql
```

(Or copy it to `scripts/setup-db.production.sql` first if you want to keep a local, gitignored copy — the template itself contains no password since it doesn't create one; it only creates the `treasurer` database.)

Confirm:
```sh
mysql -u root -p -e "SHOW DATABASES LIKE 'treasurer';"
```

---

## H. Migration

```sh
npm run migrate
```

Applies every migration in `server/src/db/migrations/` in order, inside its own transaction, tracked in a `schema_migrations` table. Idempotent — safe to run again; it only applies what's pending and reports `No pending migrations.` if there's nothing to do.

Check what ran (or what would run, before you run it):
```sh
npm run migrate:status
```
Lists every migration with `[x]` (applied, with timestamp) or `[ ] `(pending).

---

## I. Seed

```sh
npm run seed
```

Seeds the permission catalog (36 permissions) and the 6 system roles (Super Administrator, Treasurer, Assistant Treasurer, Approver, Auditor, Viewer) — required before any tenant can register. This is idempotent and safe to re-run. It does **not** insert any fake financial data, contributions, or a demo tenant — that seed step is automatically skipped whenever `NODE_ENV=production` (`server/src/db/seeds/run.js`).

There is no separate "create the first Super Administrator" step: the first real church is provisioned by an admin visiting `https://treasurer.clixworks.co.tz` and using the church registration screen, which creates the tenant and its first Super Administrator user together, atomically.

---

## J. Database Verification

```sh
npm run db:check
```

Expected output on a freshly migrated+seeded database:
```
Database connection: OK
Database: treasurer
Migration table: OK
Applied migrations: 25
Schema status: READY
```
Never prints `DB_PASSWORD` or any other secret. If `Schema status: NOT READY`, it also lists which core tables are missing — re-run `npm run migrate`.

---

## K. Frontend Build

```sh
cd ..              # back to the repo root
npm ci
VITE_API_BASE_URL=https://treasurer.clixworks.co.tz/api/v1 npm run build
```

Produces `dist/`. Verify it baked in the right URL and nothing dev-related leaked in:
```sh
grep -r "localhost:4005\|localhost:4000" dist/   # expect NO matches
grep -r "treasurer.clixworks.co.tz" dist/ | head -1   # expect a match
```

Copy `dist/` to where Nginx will serve it from (matches §M's `root` directive):
```sh
sudo mkdir -p /var/www/treasurer.clixworks.co.tz
sudo cp -r dist/* /var/www/treasurer.clixworks.co.tz/
```

---

## L. PM2 (Backend Process)

```sh
cd server
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # follow the one printed command to register PM2 with systemd
```

Confirm it's listening on the right port:
```sh
pm2 status                       # should show clix-treasury-api as "online"
curl http://127.0.0.1:4005/health   # {"success":true,"data":{"status":"ok"}}
```

Redeploying later:
```sh
cd /var/www/clix-treasury
git pull
cd server && npm ci --omit=dev && npm run migrate
cd .. && npm ci && VITE_API_BASE_URL=https://treasurer.clixworks.co.tz/api/v1 npm run build
sudo cp -r dist/* /var/www/treasurer.clixworks.co.tz/
pm2 restart clix-treasury-api
```

---

## M. Nginx

```sh
sudo apt install -y nginx
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/treasurer.clixworks.co.tz
sudo nano /etc/nginx/sites-available/treasurer.clixworks.co.tz   # fill in the CHANGE_ME paths (§N covers the TLS ones)
sudo ln -s /etc/nginx/sites-available/treasurer.clixworks.co.tz /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

The template reverse-proxies `/api/*` and `/health` to `127.0.0.1:4005` and serves `/var/www/treasurer.clixworks.co.tz` (matching §K) for everything else, with an `index.html` fallback for client-side routing.

---

## N. SSL

**Not done here — pick one, then come back and reload Nginx.**

**Option 1 — Let's Encrypt (recommended if not using Cloudflare proxying):**
```sh
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d treasurer.clixworks.co.tz
```
Certbot rewrites the Nginx config's cert paths automatically and sets up auto-renewal.

**Option 2 — Cloudflare Origin CA (if using Cloudflare's orange-cloud proxy, §O):**
Generate an Origin Certificate for `treasurer.clixworks.co.tz` in the Cloudflare dashboard (SSL/TLS → Origin Server), save the cert/key to the paths `deploy/nginx.conf.example` references (`/etc/ssl/treasurer.clixworks.co.tz/`), set Cloudflare's SSL mode to **Full (strict)**.

Either way:
```sh
sudo nginx -t && sudo systemctl reload nginx
```

---

## O. Cloudflare

**Not configured here — instructions only.**

1. In Cloudflare DNS for `clixworks.co.tz`, add an `A` record: `treasurer` → this VPS's public IP. Proxied (orange cloud) for DDoS/CDN protection, or DNS-only (grey cloud) if using Let's Encrypt without Cloudflare in front — either works with this Nginx config.
2. If proxied, set SSL/TLS mode to **Full (strict)** (requires §N Option 2, or a valid cert Cloudflare itself trusts).
3. Do not change any other DNS record for `clixworks.co.tz` — this only adds the `treasurer` subdomain.

---

## P. Health Check

```sh
curl https://treasurer.clixworks.co.tz/health
```
Expect: `{"success":true,"data":{"status":"ok"}}`. No auth required (by design — see `server/src/app.js`, mounted before any auth middleware). Exposes no internal state, no credentials, no environment variables.

---

## Q. Final QA

Once the above is live, walk through as each role (register a real church first, via the UI, to get a Super Administrator):
1. Register church → confirm redirected/logged in
2. Create an account, a fund, a category
3. Record a contribution → confirm a receipt is generated and downloadable
4. Create a pledge → record a payment against it → confirm fulfillment updates
5. Create an expense → submit → (as a second user with Approver/Treasurer) approve → pay
6. Record a transfer
7. Create a budget → confirm actual/variance populate
8. Close the financial period → confirm the closing summary is correct → reopen (Super Administrator only, with a reason) if needed
9. Run each of the 9 reports, export at least one as PDF/Excel/CSV
10. Invite a second user, assign a role, confirm they can log in
11. Log out, log back in, confirm session survives a page refresh (refresh-token flow)

If anything in this list fails, it's a real bug to fix before considering the deployment done — this is the actual acceptance test, not a formality.

---

## R. Backup

```sh
sudo mkdir -p /var/backups/clix-treasury
echo 'your-root-password' | sudo tee /root/.clix-db-password > /dev/null
sudo chmod 600 /root/.clix-db-password
```

Cron job (`sudo crontab -e`, as root):
```cron
0 2 * * * mysqldump --single-transaction -u root -p"$(cat /root/.clix-db-password)" treasurer | gzip > /var/backups/clix-treasury/$(date +\%F).sql.gz
30 2 * * * find /var/backups/clix-treasury -name '*.sql.gz' -mtime +14 -delete
```
Password is read from a root-only-readable file (`chmod 600`), never inline in the crontab where `crontab -l` could expose it — daily backup at 02:00, 14-day retention.

**Restore:**
```sh
gunzip -c /var/backups/clix-treasury/2026-08-13.sql.gz | mysql -u root -p treasurer
```
Confirm which backup file and which target database before running this — it overwrites data.

### R.1 — Security note: root vs. a restricted DB user

This deployment intentionally uses `DB_USER=root` per its own requirement — the application code has no dependency on this and works identically either way (it reads `DB_USER`/`DB_PASSWORD` from the environment with no special-casing). A dedicated least-privilege user is still the more defensible long-term setup (smaller blast radius if credentials ever leak, can't touch other databases on the instance). If wanted later, `server/scripts/setup-db.production.example.sql` documents the exact two-line addition — no code change required, just different values in `server/.env`.

---

## Deployment Command Flow (Summary)

```sh
# On the VPS, after §A-D are done:
cd /var/www
git clone <YOUR_GITHUB_REPO_URL> clix-treasury && cd clix-treasury

cd server && cp .env.example .env && nano .env    # fill in real values (§F)
npm ci --omit=dev
mysql -u root -p < scripts/setup-db.production.example.sql   # §G
npm run migrate                                               # §H
npm run seed                                                  # §I
npm run db:check                                              # §J — expect "Schema status: READY"

cd .. && npm ci
VITE_API_BASE_URL=https://treasurer.clixworks.co.tz/api/v1 npm run build   # §K
sudo mkdir -p /var/www/treasurer.clixworks.co.tz && sudo cp -r dist/* /var/www/treasurer.clixworks.co.tz/

cd server && mkdir -p logs && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup   # §L

sudo cp ../deploy/nginx.conf.example /etc/nginx/sites-available/treasurer.clixworks.co.tz
# edit CHANGE_ME paths, then:
sudo ln -s /etc/nginx/sites-available/treasurer.clixworks.co.tz /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx                  # §M

sudo certbot --nginx -d treasurer.clixworks.co.tz              # §N
# §O: point Cloudflare DNS at this VPS

curl https://treasurer.clixworks.co.tz/health                  # §P
# §Q: full role-by-role QA walkthrough
# §R: set up the backup cron job
```

---

## Rollback Basics

- **Code:** `git checkout <previous-tag-or-commit>`, `npm ci --omit=dev`, `pm2 restart clix-treasury-api`. Note the last known-good commit hash before every deploy.
- **Database schema:** `npm run migrate:down` reverts the single most-recently-applied migration ([DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §5) — use only if that migration is the actual problem; for an application bug, roll back code alone.
- **Data:** restore from backup (§R) only as a last resort — this loses everything since that backup. Financial corrections should go through the product's own reversal/adjustment mechanism, not a database restore.

---

## Production Readiness Checklist

- [x] Frontend build succeeds, verified to bake in the production API URL with zero dev-localhost references
- [x] Backend port fixed at `4005` everywhere (env default, `.env.example`, Nginx template, docs) — `4000` fully retired from this project's convention
- [x] Environment variables documented in both `.env.example` files, fail-fast on missing/weak config
- [x] Database configuration (`treasurer` / `root`) documented and requires no code change
- [x] `npm run migrate`, `npm run migrate:status`, `npm run seed`, `npm run db:check` all exist and are documented with real, project-specific commands
- [x] CORS locked to the production origin, no wildcard
- [x] Health endpoint exists, minimal, no auth required
- [x] PM2 ecosystem config exists, no secrets in it, entry point and restart behavior confirmed
- [x] Nginx config template exists (HTTPS redirect, reverse proxy to `127.0.0.1:4005`, static serving, security headers)
- [x] Backup procedure documented (daily dump, 14-day retention, restore command, password kept out of shell history/crontab)
- [ ] **Domain DNS pointed at the production host** — not done, instructions only (§O)
- [ ] **TLS certificate issued** — not done, instructions only (§N)
- [ ] **Live migration/seed run against the real production database** — blocked on server access; PENDING
- [ ] **End-to-end smoke test / QA walkthrough against the live URL** — cannot happen before the above

This document describes a deployment-ready codebase and a repeatable, project-specific procedure — it does not claim any infrastructure step actually happened. When ready, follow §A onward in order.
