import { createWriteStream, existsSync, type WriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { type ElectronApplication, _electron as electron, type Page } from '@playwright/test'

const PROJECT_ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = join(PROJECT_ROOT, 'out', 'main', 'index.js')
const ARTIFACTS_DIR = join(PROJECT_ROOT, 'e2e', '.artifacts')
const SCREENSHOT_DIR = join(ARTIFACTS_DIR, 'screenshots')
const LOG_DIR = join(ARTIFACTS_DIR, 'logs')

export interface AppHandle {
  app: ElectronApplication
  window: Page
  /** Save a PNG under e2e/.artifacts/screenshots/<name>.png. Returns absolute path. */
  screenshot: (name: string) => Promise<string>
  /** Absolute path of the combined log file for this session. */
  logPath: string
}

export async function launchApp(label = 'session'): Promise<AppHandle> {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(
      `Built main entry not found at ${MAIN_ENTRY}. Run \`npm run build\` before running E2E.`
    )
  }
  await mkdir(SCREENSHOT_DIR, { recursive: true })
  await mkdir(LOG_DIR, { recursive: true })

  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_')
  const logPath = join(LOG_DIR, `${safeLabel}.log`)
  const logStream: WriteStream = createWriteStream(logPath, { flags: 'w' })
  const writeLine = (prefix: string, text: string): void => {
    const stamp = new Date().toISOString()
    logStream.write(`[${stamp}] ${prefix} ${text}\n`)
  }

  const app = await electron.launch({
    args: [MAIN_ENTRY],
    cwd: PROJECT_ROOT,
    env: { ...process.env, NODE_ENV: 'test', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
  })

  app.process().stdout?.on('data', (chunk: Buffer) => {
    writeLine('[main stdout]', chunk.toString().trimEnd())
  })
  app.process().stderr?.on('data', (chunk: Buffer) => {
    writeLine('[main stderr]', chunk.toString().trimEnd())
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  window.on('console', (msg) => {
    writeLine(`[renderer ${msg.type()}]`, msg.text())
  })
  window.on('pageerror', (err) => {
    writeLine('[renderer error]', `${err.message}\n${err.stack ?? ''}`)
  })

  const screenshot = async (name: string): Promise<string> => {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_')
    const path = join(SCREENSHOT_DIR, `${safe}.png`)
    await window.screenshot({ path, fullPage: false })
    return path
  }

  app.on('close', () => {
    logStream.end()
  })

  return { app, window, screenshot, logPath }
}
