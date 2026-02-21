import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:8787',
  },
  webServer: {
    command: 'php artisan serve --port=8787',
    port: 8787,
    reuseExistingServer: !process.env.CI,
  },
});
