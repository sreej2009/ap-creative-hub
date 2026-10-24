import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/globalSetup.ts'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Test-only configuration. All external providers are mocked in tests;
    // these placeholder values are never valid credentials.
    env: {
      NODE_ENV: 'test',
      APP_SECRET: 'test-only-secret-0123456789abcdef0123456789abcdef',
      APP_URL: 'http://localhost:5173',
      RAZORPAY_KEY_ID: 'rzp_test_mockkey000000',
      RAZORPAY_KEY_SECRET: 'mock_key_secret_for_tests',
      RAZORPAY_WEBHOOK_SECRET: 'mock_webhook_secret_for_tests',
      CLOUDINARY_CLOUD_NAME: 'mock-cloud',
      RESERVATION_MINUTES: '30',
      RUN_JOBS: 'false',
    },
  },
});
