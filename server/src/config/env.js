import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isTest = nodeEnv === 'test';

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest,
  port: Number(process.env.PORT ?? 4000),
  db: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 3306),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: isTest ? required('DB_NAME_TEST') : required('DB_NAME'),
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 10),
  },
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
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
};
