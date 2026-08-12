import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    hookTimeout: 30000,
    testTimeout: 15000,
    fileParallelism: false, // integration tests share one MySQL test database
    env: { NODE_ENV: 'test' },
    globalSetup: ['./tests/globalSetup.js'],
    setupFiles: ['./tests/setup.js'],
  },
});
