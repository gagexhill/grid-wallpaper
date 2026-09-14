const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.cjs',
  workers: 1,
  retries: 0,
  timeout: 15000,
  use: { channel: 'msedge', viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure' }
});
