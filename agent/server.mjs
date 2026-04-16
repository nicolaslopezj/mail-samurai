#!/usr/bin/env node
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = join(ROOT, 'out', 'main', 'index.js')
const SHOTS_DIR = join(__dirname, '.shots')
const LOGS_DIR = join(__dirname, '.logs')
const LOG_FILE = join(LOGS_DIR, 'app.log')
const PORT = Number(process.env.AGENT_PORT || 9555)

if (!existsSync(MAIN_ENTRY)) {
  console.error(`[agent] built main entry not found at ${MAIN_ENTRY}`)
  console.error('[agent] run: npx electron-vite build')
  process.exit(1)
}

await mkdir(SHOTS_DIR, { recursive: true })
await mkdir(LOGS_DIR, { recursive: true })

const logStream = createWriteStream(LOG_FILE, { flags: 'w' })
const writeLog = (prefix, text) => {
  logStream.write(`[${new Date().toISOString()}] ${prefix} ${text}\n`)
}

console.log('[agent] launching Electron…')
const app = await electron.launch({
  args: [MAIN_ENTRY],
  cwd: ROOT,
  env: { ...process.env, NODE_ENV: 'development', MAIL_SAMURAI_AGENT: '1' }
})

app.process().stdout?.on('data', (d) => writeLog('[main stdout]', d.toString().trimEnd()))
app.process().stderr?.on('data', (d) => writeLog('[main stderr]', d.toString().trimEnd()))

const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')

win.on('console', (m) => writeLog(`[renderer ${m.type()}]`, m.text()))
win.on('pageerror', (e) => writeLog('[renderer error]', `${e.message}\n${e.stack ?? ''}`))

console.log('[agent] window ready:', await win.title())

const readJson = async (req) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const ok = (res, data) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(data))
}

const fail = (res, err) => {
  res.writeHead(500, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: err.message || String(err) }))
}

const routes = {
  'GET /status': async () => ({
    running: true,
    title: await win.title(),
    url: win.url(),
    port: PORT,
    shots: SHOTS_DIR,
    logs: LOG_FILE
  }),
  'POST /screenshot': async ({ name = 'shot', fullPage = false }) => {
    const safe = String(name).replace(/[^a-zA-Z0-9_-]/g, '_')
    const path = join(SHOTS_DIR, `${safe}.png`)
    await win.screenshot({ path, fullPage })
    return { path }
  },
  'POST /click': async ({ selector, timeout = 5000 }) => {
    await win.locator(selector).click({ timeout })
    return { ok: true }
  },
  'POST /fill': async ({ selector, value, timeout = 5000 }) => {
    await win.locator(selector).fill(value, { timeout })
    return { ok: true }
  },
  'POST /press': async ({ key, selector }) => {
    if (selector) await win.locator(selector).press(key)
    else await win.keyboard.press(key)
    return { ok: true }
  },
  'POST /wait': async ({ selector, state = 'visible', timeout = 5000 }) => {
    await win.locator(selector).waitFor({ state, timeout })
    return { ok: true }
  },
  'POST /eval': async ({ script }) => {
    const result = await win.evaluate(`(async () => { ${script} })()`)
    return { result: result === undefined ? null : result }
  },
  'GET /text': async ({ selector }) => ({
    text: await win.locator(selector).innerText()
  }),
  'GET /html': async () => ({ html: await win.content() }),
  'GET /logs': async ({ tail }) => {
    const content = await readFile(LOG_FILE, 'utf8')
    const lines = content.split('\n').filter(Boolean)
    const n = tail ? Number(tail) : 50
    return { lines: lines.slice(-n) }
  },
  'POST /reload': async () => {
    await win.reload()
    await win.waitForLoadState('domcontentloaded')
    return { ok: true }
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    const key = `${req.method} ${url.pathname}`

    if (url.pathname === '/quit') {
      ok(res, { bye: true })
      setTimeout(async () => {
        await app.close().catch(() => {})
        logStream.end()
        server.close()
        process.exit(0)
      }, 50)
      return
    }

    const handler = routes[key]
    if (!handler) {
      res.writeHead(404, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: `no route: ${key}` }))
    }

    const body =
      req.method === 'GET' ? Object.fromEntries(url.searchParams) : await readJson(req)
    const result = await handler(body)
    ok(res, result)
  } catch (e) {
    fail(res, e)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[agent] ready on http://127.0.0.1:${PORT}`)
  console.log(`[agent] shots: ${SHOTS_DIR}`)
  console.log(`[agent] logs:  ${LOG_FILE}`)
})

const shutdown = async () => {
  await app.close().catch(() => {})
  logStream.end()
  server.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
app.on('close', () => {
  console.log('[agent] electron closed, shutting down')
  shutdown()
})
