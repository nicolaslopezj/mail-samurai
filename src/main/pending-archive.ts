/**
 * User-initiated archive / unarchive batches that the UI should render as
 * already-applied, but that don't hit IMAP until the defer window closes.
 *
 * Why it lives in the main process + SQLite instead of the renderer:
 *  - The filter has to apply uniformly to every query (list, counts, other
 *    views). Keeping the state in React meant the sidebar lagged the list and
 *    navigating away dropped the in-flight timer.
 *  - Two tables (`pending_action_batches` + `pending_actions`) persist across
 *    restarts, so a crash or OS kill during the undo window replays cleanly
 *    instead of silently losing the user's intent.
 *
 * The `messages_effective` view (see db.ts) merges pending state into every
 * read — callers that need "is this row effectively archived?" just query
 * the view instead of re-implementing the logic.
 */

import type { PendingArchiveBatch } from '../shared/settings'
import { list as listAccounts } from './accounts-store'
import { getDb } from './db'
import { archiveMessage, unarchiveMessage } from './imap-sync'
import { clearArchivedLocal, deleteMessage, getMessageId, setArchivedLocal } from './messages-store'
import { notifyChanged, triggerSync } from './sync-scheduler'

/** How long the UI holds a batch before the real IMAP call fires. */
export const PENDING_DEFER_MS = 5000

type Mode = 'archive' | 'unarchive'

/** In-memory timers keyed by batch id — cleared on cancel and on commit. */
const timers = new Map<number, NodeJS.Timeout>()

type BatchRow = {
  id: number
  mode: string
  scheduled_at: number
  created_at: number
}

type ActionRow = {
  batch_id: number
  account_id: string
  uid: number
  subject: string | null
}

/**
 * Re-schedule timers for any batches that survived a restart. Batches whose
 * `scheduledAt` already passed commit immediately (with a microtask of delay
 * so the app has a chance to finish booting before the IMAP round-trip).
 */
export function initPendingArchive(): void {
  const db = getDb()
  const rows = db.prepare(`SELECT id, scheduled_at FROM pending_action_batches`).all() as {
    id: number
    scheduled_at: number
  }[]
  const now = Date.now()
  for (const row of rows) {
    const delay = Math.max(0, row.scheduled_at - now)
    scheduleBatch(row.id, delay)
  }
}

export function enqueue(
  entries: { accountId: string; uid: number }[],
  mode: Mode
): PendingArchiveBatch {
  if (entries.length === 0) {
    throw new Error('enqueuePendingArchive requires at least one entry')
  }

  // Single-batch model: any previously-queued batches get committed
  // immediately when the user kicks off a new one. Simpler UX (one undo
  // window at a time) and avoids stacking toasts the user has to chase.
  commitAllNow()

  const db = getDb()
  const now = Date.now()
  const scheduledAt = now + PENDING_DEFER_MS

  const batchId = db.transaction(() => {
    const insertBatch = db
      .prepare(
        `INSERT INTO pending_action_batches (mode, scheduled_at, created_at)
         VALUES (?, ?, ?)`
      )
      .run(mode, scheduledAt, now)
    const id = Number(insertBatch.lastInsertRowid)
    const insertAction = db.prepare(
      `INSERT INTO pending_actions (batch_id, account_id, uid) VALUES (?, ?, ?)`
    )
    // ON CONFLICT? The PRIMARY KEY is (account_id, uid), so re-enqueuing the
    // same row would violate it. In practice this can't happen — commitAllNow
    // just cleared every row — but keep the defensive DELETE to be safe.
    const dropDup = db.prepare(`DELETE FROM pending_actions WHERE account_id = ? AND uid = ?`)
    for (const entry of entries) {
      dropDup.run(entry.accountId, entry.uid)
      insertAction.run(id, entry.accountId, entry.uid)
    }
    return id
  })()

  scheduleBatch(batchId, PENDING_DEFER_MS)
  notifyChanged()

  const batch = readBatch(batchId)
  if (!batch) throw new Error(`pending batch ${batchId} disappeared after insert`)
  return batch
}

export function cancel(batchId: number): boolean {
  const timer = timers.get(batchId)
  if (timer) {
    clearTimeout(timer)
    timers.delete(batchId)
  }
  const db = getDb()
  const deleted = db.transaction(() => {
    db.prepare(`DELETE FROM pending_actions WHERE batch_id = ?`).run(batchId)
    const res = db.prepare(`DELETE FROM pending_action_batches WHERE id = ?`).run(batchId)
    return res.changes > 0
  })()
  if (deleted) notifyChanged()
  return deleted
}

export function list(): PendingArchiveBatch[] {
  const db = getDb()
  const batchRows = db
    .prepare(
      `SELECT id, mode, scheduled_at, created_at
       FROM pending_action_batches
       ORDER BY id ASC`
    )
    .all() as BatchRow[]
  if (batchRows.length === 0) return []
  const actionRows = db
    .prepare(
      `SELECT pa.batch_id, pa.account_id, pa.uid, m.subject
       FROM pending_actions pa
       LEFT JOIN messages m
         ON m.account_id = pa.account_id AND m.uid = pa.uid`
    )
    .all() as ActionRow[]
  const byBatch = new Map<number, PendingArchiveBatch['entries']>()
  for (const row of actionRows) {
    let entries = byBatch.get(row.batch_id)
    if (!entries) {
      entries = []
      byBatch.set(row.batch_id, entries)
    }
    entries.push({ accountId: row.account_id, uid: row.uid, subject: row.subject })
  }
  return batchRows.map((row) => ({
    id: row.id,
    mode: row.mode as Mode,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    entries: byBatch.get(row.id) ?? []
  }))
}

function readBatch(batchId: number): PendingArchiveBatch | null {
  const db = getDb()
  const batchRow = db
    .prepare(
      `SELECT id, mode, scheduled_at, created_at
       FROM pending_action_batches WHERE id = ?`
    )
    .get(batchId) as BatchRow | undefined
  if (!batchRow) return null
  const actionRows = db
    .prepare(
      `SELECT pa.batch_id, pa.account_id, pa.uid, m.subject
       FROM pending_actions pa
       LEFT JOIN messages m
         ON m.account_id = pa.account_id AND m.uid = pa.uid
       WHERE pa.batch_id = ?`
    )
    .all(batchId) as ActionRow[]
  return {
    id: batchRow.id,
    mode: batchRow.mode as Mode,
    scheduledAt: batchRow.scheduled_at,
    createdAt: batchRow.created_at,
    entries: actionRows.map((r) => ({
      accountId: r.account_id,
      uid: r.uid,
      subject: r.subject
    }))
  }
}

function scheduleBatch(batchId: number, delayMs: number): void {
  const existing = timers.get(batchId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    timers.delete(batchId)
    void commitBatch(batchId)
  }, delayMs)
  timers.set(batchId, timer)
}

function commitAllNow(): void {
  const db = getDb()
  const ids = db.prepare(`SELECT id FROM pending_action_batches`).all() as {
    id: number
  }[]
  for (const { id } of ids) {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    void commitBatch(id)
  }
}

async function commitBatch(batchId: number): Promise<void> {
  const batch = readBatch(batchId)
  if (!batch) return // already cancelled

  const db = getDb()
  // Drop pending rows first so the view flips to the "already applied" state
  // before we start the IMAP round-trip. The actual archived_at_ms update
  // happens a line below — both are atomic for the user because `notifyChanged`
  // fires once after both writes.
  const now = Date.now()
  db.transaction(() => {
    db.prepare(`DELETE FROM pending_actions WHERE batch_id = ?`).run(batchId)
    db.prepare(`DELETE FROM pending_action_batches WHERE id = ?`).run(batchId)
    for (const entry of batch.entries) {
      if (batch.mode === 'archive') {
        setArchivedLocal(entry.accountId, entry.uid, now)
      } else {
        clearArchivedLocal(entry.accountId, entry.uid)
      }
    }
  })()
  notifyChanged()

  const accountList = await listAccounts()
  const accountById = new Map(accountList.map((a) => [a.id, a]))

  // Snapshot message-ids for unarchive *before* the IMAP round-trip. The
  // post-move cleanup deletes the local row (its UID is stale), so reading
  // the id after would return null.
  const unarchiveMessageIds = new Map<string, string>()
  if (batch.mode === 'unarchive') {
    for (const entry of batch.entries) {
      const id = getMessageId(entry.accountId, entry.uid)
      if (id) unarchiveMessageIds.set(`${entry.accountId}:${entry.uid}`, id)
    }
  }

  const affectedAccounts = new Set<string>()
  for (const entry of batch.entries) {
    const account = accountById.get(entry.accountId)
    if (!account) continue
    try {
      if (batch.mode === 'archive') {
        await archiveMessage(account, entry.uid)
      } else {
        const messageId = unarchiveMessageIds.get(`${entry.accountId}:${entry.uid}`)
        if (!messageId) {
          console.error(`[pending] unarchive skipped — no message-id for uid=${entry.uid}`)
          continue
        }
        await unarchiveMessage(account, messageId)
        // The local row still holds the pre-move INBOX UID; reconcile would
        // re-archive it on the next pass. Drop it; the post-loop triggerSync
        // refetches it under its fresh UID.
        deleteMessage(entry.accountId, entry.uid)
        affectedAccounts.add(entry.accountId)
      }
    } catch (err) {
      console.error(`[pending] ${batch.mode} uid=${entry.uid} failed — reverting local:`, err)
      // Revert the local state so the list matches reality after a failure.
      if (batch.mode === 'archive') {
        clearArchivedLocal(entry.accountId, entry.uid)
      } else {
        setArchivedLocal(entry.accountId, entry.uid, now)
      }
      notifyChanged(entry.accountId)
    }
  }

  for (const accountId of affectedAccounts) {
    triggerSync(accountId).catch((err) =>
      console.error('[pending] post-unarchive sync failed:', err)
    )
  }
}
