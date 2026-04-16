import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

test('window opens and renders the skeleton', async () => {
  const { app, window, screenshot } = await launchApp()
  try {
    await expect(window.locator('h1')).toHaveText('Mail Samurai')
    await screenshot('skeleton')
  } finally {
    await app.close()
  }
})
