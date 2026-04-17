import { BrowserWindow } from 'electron'
import * as accounts from './accounts-store'
import { syncAccount } from './imap-sync'
import { pruneOlderThan } from './messages-store'
import { getPollIntervalMinutes, getRetentionHours } from './settings-store'

const STARTUP_DELAY_MS = 2_000

const inFlight = new Map<string, Promise<void>>()
let timer: NodeJS.Timeout | null = null
let currentIntervalMs: number | null = null

function notifyChanged(accountId?: string): void {
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
      const retentionHours = await getRetentionHours()
      const result = await syncAccount(account, retentionHours)
      console.log(
        `[sync] ${account.email} added=${result.added} updated=${result.updated} pruned=${result.pruned}`
      )
      notifyChanged(accountId)
    } catch (err) {
      console.error(`[sync] account=${accountId} failed:`, err)
    } finally {
      inFlight.delete(accountId)
    }
  })()
  inFlight.set(accountId, promise)
  return promise
}

export async function syncAll(): Promise<void> {
  const list = await accounts.list()
  // Defense-in-depth prune across all accounts using current retention.
  const retentionHours = await getRetentionHours()
  pruneOlderThan(Date.now() - retentionHours * 3_600_000)
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

export function startScheduler(): void {
  if (timer) return
  setTimeout(() => {
    syncAll().catch((err) => console.error('[sync] startup sync failed:', err))
  }, STARTUP_DELAY_MS)
  applyInterval().catch((err) => console.error('[sync] failed to apply interval:', err))
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
}
