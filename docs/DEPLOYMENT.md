# Deployment — Production Readiness

**Status: the codebase is deployment-ready. No infrastructure step below has actually been executed** — this document is instructions to follow, not a record of what's already been done. See [MASTER_TODO.md](MASTER_TODO.md) for what live-verification is still PENDING and why (no MySQL access in the build environment).

Production domain: **`https://treasurer.clixworks.co.tz`** — the one and only production domain for this product. Never localhost, `127.0.0.1`, a demo domain, or an old Clix project domain in any production configuration.

Target host: a single Contabo VPS running the Node backend (via PM2), MySQL 8, and Nginx (reverse proxy + static frontend serving) — the architecture decided in [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md).

---

## 1. Environment Variables

Two `.env.example` files exist, already accurate to what the code actually reads — copy each to a real `.env` on the server and fill in real values there, never in source control ([DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md) §3):

- **`server/.env.example`** → `server/.env`: `NODE_ENV=production`, `PORT`, `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`, `JWT_ACCESS_SECRET` (generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` — as of Phase 11 this must be at least 32 characters or the server refuses to start), `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `LOGIN_MAX_ATTEMPTS`/`LOGIN_LOCKOUT_MINUTES`, `PASSWORD_RESET_TTL_MINUTES`, `FRONTEND_URL=https://treasurer.clixworks.co.tz`, `CORS_ORIGINS=https://treasurer.clixworks.co.tz`.
- **`.env.example`** (repo root, frontend) → `.env.production` (Vite convention) or set at build time: `VITE_API_BASE_URL=https://treasurer.clixworks.co.tz/api/v1`.

There is no `JWT_REFRESH_SECRET` — refresh tokens are opaque random values (`crypto.randomBytes`), never JWTs, so there is nothing to sign them with ([SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §2). Don't add one; it would be an unused variable.

`server/src/config/env.js` fails fast (refuses to start) if any required variable is missing or the JWT secret is too short — a misconfigured production deploy cannot silently fall back to a development default.

---

## 2. Database Setup

Run once, manually, as MySQL root, directly on the production host:

```sh
cp server/scripts/setup-db.production.example.sql server/scripts/setup-db.production.sql
# edit setup-db.production.sql: replace CHANGE_ME_STRONG_GENERATED_PASSWORD
mysql -u root -p < server/scripts/setup-db.production.sql
```

This creates `clix_treasury_production` and a least-privilege `clix_app`@`localhost` user — the application never connects as MySQL root ([MASTER_TODO.md](MASTER_TODO.md) Phase 12 §12.7). `setup-db.production.sql` is gitignored — it contains a real credential once filled in.

Put the same password in `server/.env` as `DB_PASSWORD`, then:

```sh
cd server
npm ci --omit=dev
npm run migrate     # applies every migration in src/db/migrations/, in order, idempotent
npm run seed        # seeds the permission catalog + system roles (required before any tenant can register)
```

`npm run seed` skips the dev demo tenant automatically when `NODE_ENV=production` ([server/src/db/seeds/run.js](../server/src/db/seeds/run.js)) — production seeding only ever creates the permission/role catalog, never fake financial data ([MASTER_TODO.md](MASTER_TODO.md) §12.15).

**Verify:** connect as `clix_app` and confirm `SHOW TABLES` lists every table through `schema_migrations`, and `SELECT COUNT(*) FROM permissions` returns the full seeded catalog (36 permissions as of Phase 11). The first real tenant is created by an admin visiting the app and using the church registration screen — there is no separate "create the first church" CLI step.

---

## 3. Frontend Build

```sh
npm ci
VITE_API_BASE_URL=https://treasurer.clixworks.co.tz/api/v1 npm run build
```

Produces `dist/` — copy its contents to wherever Nginx's `root` points (see §5). Confirm the build did not silently fall back to `http://localhost:4000/api/v1` (the dev default) — grep the built JS for `localhost` and expect no matches (`grep -r localhost dist/` should return nothing).

---

## 4. Backend Start (PM2)

```sh
cd server
pm2 start ecosystem.config.cjs
pm2 save          # persist the process list across reboots
pm2 startup       # one-time: registers PM2 with systemd so it survives a server reboot
```

`ecosystem.config.cjs` contains no secrets — see the comments in that file. It expects `server/.env` to already exist (§1) and `server/logs/` to be writable (PM2 creates it if missing).

Redeploy after a code change:
```sh
git pull
npm ci --omit=dev
npm run migrate    # no-op if nothing pending — safe to always run
pm2 restart clix-treasury-api
```

---

## 5. Nginx

Template: [`deploy/nginx.conf.example`](../deploy/nginx.conf.example). Copy to `/etc/nginx/sites-available/treasurer.clixworks.co.tz`, fill in the `CHANGE_ME` paths (TLS cert/key location, frontend `dist/` location), symlink into `sites-enabled/`, then:

```sh
nginx -t && systemctl reload nginx
```

It terminates TLS, redirects HTTP→HTTPS, reverse-proxies `/api/*` and `/health` to the Node process on `127.0.0.1:4000`, and serves the built frontend for everything else with a client-routing fallback to `index.html`.

---

## 6. Cloudflare / DNS / SSL

**Not configured — instructions only, nothing below has been executed.**

1. In Cloudflare DNS for `clixworks.co.tz`, add an `A` (or `CNAME`) record: `treasurer` → the VPS's public IP, proxied (orange cloud) for DDoS/CDN protection.
2. Choose one of two TLS paths:
   - **Cloudflare Origin CA** (simpler, ties the cert to Cloudflare): generate an Origin Certificate in the Cloudflare dashboard for `treasurer.clixworks.co.tz`, install it at the paths `deploy/nginx.conf.example` references, set Cloudflare's SSL mode to "Full (strict)".
   - **Let's Encrypt / Certbot** (works even if Cloudflare proxying is later disabled): `certbot --nginx -d treasurer.clixworks.co.tz`, which also rewrites the Nginx config's cert paths automatically — reconcile with `deploy/nginx.conf.example` afterward if they diverge.
3. Verify `https://treasurer.clixworks.co.tz/health` returns `{"success":true,"data":{"status":"ok"}}` before pointing real traffic at it.

---

## 7. Database Backup

Minimum viable, cron-driven — no bespoke backup-management application ([MASTER_TODO.md](MASTER_TODO.md) §12.8: "do not build an unnecessary backup management application"):

```sh
# /etc/cron.d/clix-treasury-backup — daily at 02:00 server time
0 2 * * * root mysqldump --single-transaction -u clix_app -p"$(cat /root/.clix-db-password)" clix_treasury_production | gzip > /var/backups/clix-treasury/$(date +\%F).sql.gz
```

- **Retention:** keep 14 daily backups; a simple follow-up line (`find /var/backups/clix-treasury -mtime +14 -delete`) or a log-rotate-style tool is enough — don't build a retention UI.
- **Restore procedure:** `gunzip -c /var/backups/clix-treasury/2026-08-13.sql.gz | mysql -u root -p clix_treasury_production` (into a freshly-created empty database, or the existing one if intentionally overwriting — confirm which before running).
- Store the DB password used by the cron job outside of source control and outside the web root (e.g. a root-only-readable file, `chmod 600`), never inline in the crontab where `crontab -l` or process listings could expose it.

---

## 8. Logging

- **Application:** PM2 writes `server/logs/out.log` / `server/logs/error.log` (see `ecosystem.config.cjs`). `errorHandler.js` logs every unhandled exception server-side unconditionally as of Phase 11 (previously only outside production — a real gap that's now fixed), while still returning a redacted, generic message to the client in production. `pm2 logs clix-treasury-api` tails both in real time.
- **Never logged:** passwords, JWT secrets, database credentials, raw tokens ([SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §7) — verified by test. Audit-log entries (`audit_logs` table, `GET /api/v1/audit-logs`) cover security/financial *events*, not general application logging — the two are complementary, not the same thing.
- **Nginx:** default access/error logs at `/var/log/nginx/` — sufficient for this scale; the `/health` endpoint is excluded from Nginx's access log (see the config template) since it's polled frequently and not diagnostically interesting.

---

## 9. Health Check

`GET /health` (no auth required, mounted before any auth middleware in `server/src/app.js`) returns:
```json
{ "success": true, "data": { "status": "ok" } }
```
Reachable at `https://treasurer.clixworks.co.tz/health` once Nginx is configured (§5). Suitable for an uptime monitor (Cloudflare health checks, UptimeRobot, or similar) — deliberately minimal, exposes no internal state.

---

## 10. Rollback Basics

- **Code:** `git checkout <previous-tag-or-commit>`, `npm ci --omit=dev`, `pm2 restart clix-treasury-api`. Keep the last known-good commit hash noted before any deploy.
- **Database schema:** `npm run migrate:down` reverts the single most-recently-applied migration (see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §5) — use only if the just-applied migration is the actual problem; for a bad *deploy* (application bug, not a schema issue), rolling back code alone is almost always the right move, migrations are additive and forward-compatible by convention.
- **Data:** restore from the most recent backup (§7) only as a last resort — this loses everything recorded since that backup. Financial corrections should go through the product's own reversal/adjustment mechanism wherever possible, not a database restore.

---

## 11. Production Readiness Checklist

- [x] Frontend build succeeds (`npm run build`), no `localhost` baked into output
- [x] Backend imports/boots cleanly (`node -e "import('./src/app.js')"` — see below for the actual DB-dependent startup, which is PENDING)
- [x] Environment variables documented in `.env.example` (both), fail-fast on missing/weak config
- [x] CORS locked to the production origin, no wildcard
- [x] Health endpoint exists and is minimal
- [x] PM2 ecosystem config exists, no secrets in it
- [x] Nginx config template exists (HTTPS redirect, reverse proxy, static serving, security headers)
- [x] Database setup procedure documented, least-privilege app user (never root)
- [x] Backup procedure documented (daily dump, 14-day retention, restore command)
- [x] Migration/seed commands documented
- [ ] **Domain DNS pointed at the production host** — not done, instructions only (§6)
- [ ] **TLS certificate issued** — not done, instructions only (§6)
- [ ] **Live migration/seed run against the real production database** — blocked on DB access; PENDING
- [ ] **End-to-end smoke test against the live URL** — cannot happen before the above

---

## 12. What Remains — Explicitly

This document describes a deployment-ready codebase and a documented, repeatable procedure — it does **not** claim any of the following happened:
- DNS was pointed at a server
- An SSL certificate was issued
- `npm run migrate`/`npm run seed` ran against a real production database
- The application was started and reached from the public internet

All of the above require a real Contabo VPS and DNS control that this build environment doesn't have. When ready to actually deploy, follow §§2–6 in order.
