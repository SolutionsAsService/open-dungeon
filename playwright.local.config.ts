import { defineConfig } from '@playwright/test';

// Local (serverless) mode: the built SPA on a plain static server, like Vercel/GitHub Pages.
const PORT = 8791;
export default defineConfig({
  testDir: 'tests/e2e-local',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:' + PORT, trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
  webServer: {
    command: 'npx vite build && npx vite preview --port ' + PORT + ' --strictPort',
    url: 'http://localhost:' + PORT + '/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
