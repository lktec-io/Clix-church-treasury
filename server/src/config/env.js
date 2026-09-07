import dotenv from 'dotenv';
import { normalizeSenderId, senderIdWarning, wasNormalized } from '../modules/sms/senderId.js';

// `override: true` is deliberate, not the default. Plain `dotenv/config`
// (or `dotenv.config()` with no options) never overwrites a variable that
// already exists in process.env — so if BEEM_API_KEY/BEEM_SECRET_KEY (or
// anything else) was ever set directly in the host shell, in PM2's saved
// daemon environment (`pm2 save`), or inherited from systemd, editing
// server/.env afterward would silently do nothing: no error, no warning,
// the stale value just wins forever, indistinguishable from ".env changes
// aren't taking effect." That is the exact class of bug behind "edited
// .env, restarted, still get a Beem 401" — the documented design intent
// (ecosystem.config.cjs, .env.example) is that server/.env is the one and
// only source of real configuration in production, so it must always win.
dotenv.config({ override: true });

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// A short/guessable secret makes HS256 tokens forgeable by brute force —
// fail fast at startup rather than silently accepting a weak one
// (docs/MASTER_TODO.md Phase 11: "look for ... weak validation").
function requiredSecret(name, minLength = 32) {
  const value = required(name);
  if (value.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters — generate one with node's crypto.randomBytes`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isTest = nodeEnv === 'test';

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest,
  port: Number(process.env.PORT ?? 4005),
  db: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 3306),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: isTest ? required('DB_NAME_TEST') : required('DB_NAME'),
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 10),
  },
  jwt: {
    accessSecret: requiredSecret('JWT_ACCESS_SECRET'),
    accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  },
  refreshToken: {
    ttlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  },
  login: {
    maxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5),
    lockoutMinutes: Number(process.env.LOGIN_LOCKOUT_MINUTES ?? 15),
  },
  passwordReset: {
    ttlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 30),
  },
  cors: {
    // Required, not defaulted — a misconfigured deploy should fail to start
    // rather than silently fall back to a dev origin in production.
    origins: required('CORS_ORIGINS').split(',').map((o) => o.trim()),
  },
  // Production: https://treasurer.clixworks.co.tz — the one and only
  // production domain for this product (docs/PROJECT_ARCHITECTURE.md).
  // Not yet consumed anywhere (no email-link generation exists until
  // Phase 7+), but present now so it's configured once, correctly, ahead
  // of that need rather than improvised later.
  frontendUrl: required('FRONTEND_URL'),
  sms: buildSmsConfig(),
};

// Real SMS sending only turns on once BEEM_API_KEY/BEEM_SECRET_KEY are
// both set — until then `provider` resolves to 'noop', which logs and
// records every attempt in sms_log without making a network call
// (server/src/modules/sms/sms.service.js). Never required at startup as a
// pair being *absent*: an unconfigured deployment must still boot and
// record contributions.
//
// What IS required to fail fast: a *partial* configuration — one of
// BEEM_API_KEY/BEEM_SECRET_KEY set without the other. That state is
// otherwise invisible: it silently resolves to `provider: 'noop'`, so an
// admin who set one variable and typo'd/forgot the other gets a server
// that starts cleanly and looks fine, with SMS quietly never sending and
// no error anywhere pointing at why. Refusing to boot here turns a
// support mystery into an immediate, specific startup error.
function buildSmsConfig() {
  // Credentials are trimmed for exactly the same reason the sender ID is:
  // a trailing space or a \r from a CRLF .env is invisible in an editor but
  // changes the Basic-Auth string and produces a 401 that looks like a
  // wrong key. Only surrounding whitespace is touched — never the value.
  const apiKey = (process.env.BEEM_API_KEY ?? '').trim();
  const secretKey = (process.env.BEEM_SECRET_KEY ?? '').trim();
  const rawSenderId = process.env.BEEM_SENDER_ID ?? '';
  const senderId = normalizeSenderId(rawSenderId);
  const apiUrl = (process.env.BEEM_API_URL ?? 'https://apisms.beem.africa/v1/send').trim();

  if (Boolean(apiKey) !== Boolean(secretKey)) {
    throw new Error(
      'Partial Beem SMS configuration: exactly one of BEEM_API_KEY / BEEM_SECRET_KEY is set. ' +
        'Set both to enable SMS sending, or clear both to run with SMS disabled — a single ' +
        'variable left set silently falls back to the no-op provider with no other warning.'
    );
  }

  const provider = apiKey && secretKey ? 'beem' : 'noop';

  // Sender-ID problems are reported at BOOT, not only on the first failed
  // send. Previously the only signal was a warning attached to an
  // already-failed message, so a deployment could sit in a 403 rejection
  // loop with the explanation buried in per-send logs — and a church only
  // finds out because members stopped receiving receipts.
  if (provider === 'beem') {
    if (wasNormalized(rawSenderId, senderId)) {
      // The highest-value line here: the raw value LOOKS correct in the
      // file, so without this an operator has no way to see the difference.
      console.warn(
        `[sms] BEEM_SENDER_ID was normalised before use: ${JSON.stringify(rawSenderId)} -> ` +
          `${JSON.stringify(senderId)}. Beem matches the approved sender ID exactly, so the stray ` +
          'whitespace/quotes would have been rejected. Update server/.env to the normalised value.'
      );
    }
    const warning = senderIdWarning(senderId);
    if (warning) {
      console.warn(
        `[sms] BEEM_SENDER_ID ${warning}. Beem answers 403 (not 401) when credentials are valid but the ` +
          'sender ID is unapproved — check the approved sender ID in the Beem dashboard, including its capitalisation.'
      );
    }
  }

  return { provider, beem: { apiKey, secretKey, senderId, apiUrl } };
}
