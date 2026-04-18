import { BrowserWindow } from 'electron'
import { ImapFlow } from 'imapflow'
import type { Account } from '../shared/settings'
import { ARCHIVE_RETENTION_MS } from '../shared/settings'
import * as accounts from './accounts-store'
import { getPassword } from './accounts-store'
import { categorizePendingMessages } from './ai-auto'
import { syncCloudNow } from './cloud-sync'
import { syncAccount } from './imap-sync'
import { prunePermanent } from './messages-store'
import { getPollIntervalMinutes, getSyncFromMs, getUiSettings } from './settings-store'

const STARTUP_DELAY_MS = 2_000
const REALTIME_IDLE_MAX_MS = 29 * 60 * 1000
const REALTIME_RECONNECT_BASE_MS = 5_000
const REALTIME_RECONNECT_MAX_MS = 60_000
const REALTIME_SYNC_DEBOUNCE_MS = 1_500
/**
 * How often we pull the cloud event log. Independent of the IMAP interval
 * because the cost profile is different: an IMAP sync is a full mailbox
 * round-trip (heavy), whereas a cloud pull is a single HTTP call returning
 * only events newer than the local cursor. 30s gives listen-only devices an
 * almost-real-time feel without hammering anything.
 */
const CLOUD_POLL_MS = 30_000

const inFlight = new Map<string, Promise<void>>()
const realtimeWorkers = new Map<string, RealtimeWorker>()
let timer: NodeJS.Timeout | null = null
let currentIntervalMs: number | null = null
let cloudTimer: NodeJS.Timeout | null = null
let cloudInFlight = false

type RealtimeWorker = {
  account: Account
  stopped: boolean
  reconnectAttempt: number
  client: ImapFlow | null
  syncTimer: NodeJS.Timeout | null
}

export function notifyChanged(accountId?: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('messages:changed', { accountId })
  }
}

async function runOne(accountId: string): Promise<void> {
  const existing = inFlight.get(accountId)
  if (existing) return existing
  const promise = (async () => {
    try {
      const list = await accounts.list()
      const account = list.find((a) => a.id === accountId)
      if (!account) return
      const syncFromMs = await getSyncFromMs()
      const result = await syncAccount(account, syncFromMs)
      console.log(
        `[sync] ${account.email} added=${result.added} updated=${result.updated} archived=${result.archived} deleted=${result.deleted}`
      )
      notifyChanged(accountId)
      // Fire-and-forget: the categorizer serializes itself internally, so
      // concurrent sync runs across accounts collapse into a single pass.
      categorizePendingMessages().catch((err) =>
        console.error('[ai] auto-categorize pass failed:', err)
      )
    } catch (err) {
      console.error(`[sync] account=${accountId} failed:`, err)
    } finally {
      inFlight.delete(accountId)
    }
  })()
  inFlight.set(accountId, promise)
  return promise
}

function attachImapErrorHandler(client: ImapFlow, accountEmail: string): ImapFlow {
  client.on('error', (err) => {
    const code = (err as { code?: string } | null)?.code
    const method =
      code === 'EPIPE' || code === 'ECONNRESET' || code === 'ETIMEDOUT' ? 'warn' : 'error'
    console[method](`[imap:idle] ${accountEmail} connection error${code ? ` (${code})` : ''}:`, err)
  })
  return client
}

function makeRealtimeClient(account: Account, password: string): ImapFlow {
  return attachImapErrorHandler(
    new ImapFlow({
      host: account.host,
      port: account.port,
      secure: true,
      auth: { user: account.email, pass: password },
      logger: false,
      disableAutoIdle: true,
      maxIdleTime: REALTIME_IDLE_MAX_MS,
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 60_000
    }),
    account.email
  )
}

function computeReconnectDelay(attempt: number): number {
  return Math.min(
    REALTIME_RECONNECT_BASE_MS * Math.max(1, 2 ** Math.max(0, attempt - 1)),
    REALTIME_RECONNECT_MAX_MS
  )
}

async function closeRealtimeClient(client: ImapFlow | null): Promise<void> {
  if (!client) return
  try {
    await client.logout()
  } catch {
    // ignore
  }
}

function scheduleRealtimeSync(worker: RealtimeWorker, reason: string): void {
  if (worker.stopped || worker.syncTimer) return
  worker.syncTimer = setTimeout(() => {
    worker.syncTimer = null
    runOne(worker.account.id).catch((err) =>
      console.error(`[imap:idle] ${worker.account.email} ${reason} sync failed:`, err)
    )
  }, REALTIME_SYNC_DEBOUNCE_MS)
}

async function runRealtimeWorker(worker: RealtimeWorker): Promise<void> {
  while (!worker.stopped) {
    let client: ImapFlow | null = null
    try {
      const password = await getPassword(worker.account.id)
      if (!password) {
        console.warn(`[imap:idle] no password for ${worker.account.email}; stopping watcher`)
        worker.stopped = true
        return
      }

      client = makeRealtimeClient(worker.account, password)
      worker.client = client

      client.on('exists', (data) => {
        if (data.path !== 'INBOX') return
        if (data.count === data.prevCount) return
        scheduleRealtimeSync(worker, 'exists')
      })

      client.on('expunge', (data) => {
        if (data.path !== 'INBOX') return
        scheduleRealtimeSync(worker, 'expunge')
      })

      client.on('close', () => {
        if (worker.stopped) return
        console.warn(`[imap:idle] ${worker.account.email} connection closed`)
      })

      await client.connect()
      await client.mailboxOpen('INBOX')
      worker.reconnectAttempt = 0
      scheduleRealtimeSync(worker, 'connected')
      console.log(`[imap:idle] watching ${worker.account.email}`)

      while (!worker.stopped) {
        const continued = await client.idle()
        if (!continued) break
      }
    } catch (err) {
      if (!worker.stopped) {
        console.error(`[imap:idle] ${worker.account.email} watcher failed:`, err)
      }
    } finally {
      worker.client = null
      await closeRealtimeClient(client)
    }

    if (worker.stopped) return

    worker.reconnectAttempt += 1
    const delay = computeReconnectDelay(worker.reconnectAttempt)
    console.log(`[imap:idle] reconnecting ${worker.account.email} in ${Math.round(delay / 1000)}s`)
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
}

function startRealtimeWorker(account: Account): void {
  const existing = realtimeWorkers.get(account.id)
  if (existing) {
    existing.account = account
    return
  }
  const worker: RealtimeWorker = {
    account,
    stopped: false,
    reconnectAttempt: 0,
    client: null,
    syncTimer: null
  }
  realtimeWorkers.set(account.id, worker)
  runRealtimeWorker(worker).finally(() => {
    if (realtimeWorkers.get(account.id) === worker) {
      realtimeWorkers.delete(account.id)
    }
  })
}

function stopRealtimeWorker(worker: RealtimeWorker): void {
  worker.stopped = true
  if (worker.syncTimer) {
    clearTimeout(worker.syncTimer)
    worker.syncTimer = null
  }
  void closeRealtimeClient(worker.client)
  realtimeWorkers.delete(worker.account.id)
}

export async function reloadRealtimeSync(): Promise<void> {
  const list = await accounts.list()
  const wanted = new Map(list.map((account) => [account.id, account]))

  for (const worker of realtimeWorkers.values()) {
    const next = wanted.get(worker.account.id)
    if (!next) {
      stopRealtimeWorker(worker)
      continue
    }
    worker.account = next
  }

  for (const account of list) {
    startRealtimeWorker(account)
  }
}

export async function syncAll(): Promise<void> {
  const list = await accounts.list()
  // Defense-in-depth global prune across all accounts.
  const syncFromMs = await getSyncFromMs()
  prunePermanent(syncFromMs, ARCHIVE_RETENTION_MS)
  await Promise.all(list.map((a) => runOne(a.id)))
  notifyChanged()
}

export async function triggerSync(accountId?: string): Promise<void> {
  if (accountId) {
    await runOne(accountId)
  } else {
    await syncAll()
  }
}

async function applyInterval(): Promise<void> {
  const minutes = await getPollIntervalMinutes()
  const ms = minutes * 60 * 1000
  if (timer && currentIntervalMs === ms) return
  if (timer) clearInterval(timer)
  currentIntervalMs = ms
  timer = setInterval(() => {
    syncAll().catch((err) => console.error('[sync] interval sync failed:', err))
  }, ms)
  console.log(`[sync] interval set to ${minutes} min`)
}

/**
 * Tick the cloud sync. No-op while disconnected (checked inside `syncCloudNow`)
 * and while a previous pull is still in flight, so overlapping ticks collapse.
 */
async function pollCloud(): Promise<void> {
  if (cloudInFlight) return
  const settings = await getUiSettings()
  if (!settings.cloud.enabled) return
  cloudInFlight = true
  try {
    await syncCloudNow()
    notifyChanged()
  } catch (err) {
    console.error('[cloud] poll failed:', err)
  } finally {
    cloudInFlight = false
  }
}

export function startScheduler(): void {
  if (timer) return
  setTimeout(() => {
    syncAll().catch((err) => console.error('[sync] startup sync failed:', err))
  }, STARTUP_DELAY_MS)
  applyInterval().catch((err) => console.error('[sync] failed to apply interval:', err))
  reloadRealtimeSync().catch((err) => console.error('[imap:idle] failed to start watchers:', err))

  // Cloud pull runs on its own short timer so listen-only devices (and the
  // primary's own UI) pick up changes from other devices within 30s.
  if (!cloudTimer) {
    cloudTimer = setInterval(() => {
      pollCloud().catch((err) => console.error('[cloud] interval poll failed:', err))
    }, CLOUD_POLL_MS)
  }
}

/** Re-read the configured interval and reschedule if it changed. */
export async function reloadInterval(): Promise<void> {
  await applyInterval()
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
    currentIntervalMs = null
  }
  if (cloudTimer) {
    clearInterval(cloudTimer)
    cloudTimer = null
  }
  for (const worker of [...realtimeWorkers.values()]) {
    stopRealtimeWorker(worker)
  }
}
