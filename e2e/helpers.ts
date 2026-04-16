import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { type ElectronApplication, _electron as electron, type Page } from '@playwright/test'

const PROJECT_ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = join(PROJECT_ROOT, 'out', 'main', 'index.js')
const SCREENSHOT_DIR = join(PROJECT_ROOT, 'e2e', '.artifacts', 'screenshots')

export interface AppHandle {
  app: ElectronApplication
  window: Page
  /** Save a PNG under e2e/.artifacts/screenshots/<name>.png. Returns absolute path. */
  screenshot: (name: string) => Promise<string>
}

export async function launchApp(): Promise<AppHandle> {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(
      `Built main entry not found at ${MAIN_ENTRY}. Run \`npm run build\` before running E2E.`
    )
  }
  await mkdir(SCREENSHOT_DIR, { recursive: true })

  const app = await electron.launch({
    args: [MAIN_ENTRY],
    cwd: PROJECT_ROOT,
    env: { ...process.env, NODE_ENV: 'test', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  const screenshot = async (name: string): Promise<string> => {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_')
    const path = join(SCREENSHOT_DIR, `${safe}.png`)
    await window.screenshot({ path, fullPage: false })
    return path
  }

  return { app, window, screenshot }
}
