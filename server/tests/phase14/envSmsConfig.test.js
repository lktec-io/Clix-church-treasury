import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// env.js calls dotenv.config({ override: true }) at import time, which
// would otherwise load the real server/.env and stomp whatever this test
// sets on process.env first. Stubbing dotenv to a no-op is what makes
// env.js's SMS validation testable in isolation, with fully synthetic
// values — never a real credential (backend stabilization Phase 20: "Do
// NOT put real secrets into tests").
vi.mock('dotenv', () => ({ default: { config: () => {} } }));

const REQUIRED_BASE_ENV = {
  DB_HOST: 'localhost',
  DB_USER: 'test',
  DB_PASSWORD: 'test',
  DB_NAME: 'test_db',
  DB_NAME_TEST: 'test_db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  CORS_ORIGINS: 'http://localhost:5173',
  FRONTEND_URL: 'http://localhost:5173',
};

async function importEnvWith(overrides) {
  const originalEnv = { ...process.env };
  Object.keys(process.env).forEach((key) => {
    if (key.startsWith('BEEM_') || key === 'NODE_ENV') delete process.env[key];
  });
  process.env.NODE_ENV = 'development'; // required('DB_NAME') branch, not the test-only DB_NAME_TEST one
  Object.assign(process.env, REQUIRED_BASE_ENV, overrides);

  vi.resetModules();
  try {
    return await import('../../src/config/env.js');
  } finally {
    process.env = originalEnv;
  }
}

describe('env.js — SMS configuration fail-fast validation', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.resetModules();
  });

  it('resolves to the noop provider when neither BEEM_API_KEY nor BEEM_SECRET_KEY is set', async () => {
    const { env } = await importEnvWith({});
    expect(env.sms.provider).toBe('noop');
  });

  it('resolves to the beem provider when both BEEM_API_KEY and BEEM_SECRET_KEY are set', async () => {
    const { env } = await importEnvWith({ BEEM_API_KEY: 'k', BEEM_SECRET_KEY: 's' });
    expect(env.sms.provider).toBe('beem');
    expect(env.sms.beem.apiKey).toBe('k');
    expect(env.sms.beem.secretKey).toBe('s');
  });

  it('throws at startup — does not silently fall back to noop — when only BEEM_API_KEY is set', async () => {
    await expect(importEnvWith({ BEEM_API_KEY: 'k' })).rejects.toThrow(/Partial Beem SMS configuration/);
  });

  it('throws at startup when only BEEM_SECRET_KEY is set', async () => {
    await expect(importEnvWith({ BEEM_SECRET_KEY: 's' })).rejects.toThrow(/Partial Beem SMS configuration/);
  });

  it('defaults BEEM_API_URL to the documented Beem send endpoint when unset', async () => {
    const { env } = await importEnvWith({ BEEM_API_KEY: 'k', BEEM_SECRET_KEY: 's' });
    expect(env.sms.beem.apiUrl).toBe('https://apisms.beem.africa/v1/send');
  });

  it('honors an explicit BEEM_API_URL override', async () => {
    const { env } = await importEnvWith({ BEEM_API_KEY: 'k', BEEM_SECRET_KEY: 's', BEEM_API_URL: 'https://example.test/send' });
    expect(env.sms.beem.apiUrl).toBe('https://example.test/send');
  });
});
