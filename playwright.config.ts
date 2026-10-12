import { defineConfig } from '@playwright/test';

const PORT = 8790;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:' + PORT, trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
  webServer: {
    command: 'node -e "require(\'fs\').rmSync(\'.data-e2e\',{recursive:true,force:true})" && npx vite build && npx tsx server/main.ts',
    url: 'http://localhost:' + PORT + '/healthz',
    env: { PORT: String(PORT), DATA_DIR: '.data-e2e' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
