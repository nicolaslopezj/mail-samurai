import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'line' : [['list']],
  outputDir: './e2e/.artifacts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  timeout: 30_000,
  expect: { timeout: 5_000 }
})
