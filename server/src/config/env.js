import 'dotenv/config';

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
  // Real SMS sending only turns on once BEEM_API_KEY/BEEM_SECRET_KEY are
  // both set — until then `provider` resolves to 'noop', which logs and
  // records every attempt in sms_log without making a network call
  // (server/src/modules/sms/sms.service.js). Never required at startup:
  // an unconfigured deployment must still boot and record contributions.
  sms: {
    provider: process.env.BEEM_API_KEY && process.env.BEEM_SECRET_KEY ? 'beem' : 'noop',
    beem: {
      apiKey: process.env.BEEM_API_KEY ?? '',
      secretKey: process.env.BEEM_SECRET_KEY ?? '',
      senderId: process.env.BEEM_SENDER_ID ?? '',
      apiUrl: process.env.BEEM_API_URL ?? 'https://apisms.beem.africa/v1/send',
    },
  },
};
