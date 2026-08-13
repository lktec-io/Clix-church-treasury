// PM2 process manager config for the Clix Treasury API in production.
// `.cjs` extension deliberately — this package is `"type": "module"`
// (ESM), and PM2's ecosystem loader is most reliable as plain CommonJS
// regardless of the package's own module type.
//
// Contains NO secrets. All real configuration (DB credentials, JWT secret,
// CORS origins, etc.) comes from `server/.env` on the production host via
// `dotenv/config`, which `src/config/env.js` already imports — PM2 doesn't
// need to inject anything beyond NODE_ENV. Copy `.env.example` to `.env` on
// the server and fill in real values there; never in this file.
//
// Usage (run from server/):
//   pm2 start ecosystem.config.cjs
//   pm2 save                        # persist across reboots
//   pm2 startup                     # one-time: register PM2 with systemd
//   pm2 logs clix-treasury-api
//   pm2 restart clix-treasury-api   # e.g. after a deploy
module.exports = {
  apps: [
    {
      name: 'clix-treasury-api',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork', // single instance is the right scale for this product — see docs/DEPLOYMENT.md
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s', // a crash-loop (<30s uptime) still restarts, but PM2 won't call it "stable" and keep hammering forever
      restart_delay: 3000,
      watch: false, // never watch/reload on file change in production
      env: {
        NODE_ENV: 'production',
      },
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      merge_logs: true,
      time: true, // timestamp every log line
      max_memory_restart: '400M',
    },
  ],
};
