import type {
  EmailAddress,
  InlineAttachment,
  Message,
  MessageCounts,
  MessagesQuery,
  MessageWithBody
} from '../shared/settings'
import { getDb } from './db'

type MessageRow = {
  account_id: string
  uid_validity: number
  uid: number
  message_id: string | null
  subject: string | null
  from_name: string | null
  from_address: string | null
  to_json: string
  cc_json: string
  date_ms: number
  flags_json: string
  seen: number
  flagged: number
  snippet: string | null
  category_id: string | null
  ai_summary: string | null
  categorized_at: number | null
  archived_at_ms: number | null
}

type MessageRowWithBody = MessageRow & {
  body_text: string | null
  body_html: string | null
}

function parseAddresses(json: string): EmailAddress[] {
  try {
    const parsed = JSON.parse(json) as EmailAddress[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseFlags(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as string[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function rowToMessage(row: MessageRow): Message {
  return {
    accountId: row.account_id,
    uid: row.uid,
    uidValidity: row.uid_validity,
    messageId: row.message_id,
    subject: row.subject,
    from: row.from_address !== null ? { name: row.from_name, address: row.from_address } : null,
    to: parseAddresses(row.to_json),
    cc: parseAddresses(row.cc_json),
    date: row.date_ms,
    flags: parseFlags(row.flags_json),
    seen: row.seen === 1,
    flagged: row.flagged === 1,
    snippet: row.snippet,
    categoryId: row.category_id,
    aiSummary: row.ai_summary,
    categorizedAt: row.categorized_at,
    archivedAt: row.archived_at_ms
  }
}

/**
 * Counts used by the sidebar badges. "Inbox" counts unread non-archived
 * messages (the Inbox bucket — messages stay there until archived, regardless
 * of AI categorization). "Other" counts unread messages the AI reviewed but
 * didn't match any category. "Todo" is the total number of messages (read or
 * not) whose category has a `todo` action — it's a follow-up list, so
 * read/unread doesn't matter.
 */
export function getCounts(todoCategoryIds: string[]): MessageCounts {
  const db = getDb()
  const inboxRows = db
    .prepare(
      `SELECT account_id, COUNT(*) AS n FROM messages
       WHERE seen = 0 AND archived_at_ms IS NULL
       GROUP BY account_id`
    )
    .all() as { account_id: string; n: number }[]
  const inboxUnread: Record<string, number> = {}
  let inboxUnreadTotal = 0
  for (const r of inboxRows) {
    inboxUnread[r.account_id] = r.n
    inboxUnreadTotal += r.n
  }
  const categoryRows = db
    .prepare(
      `SELECT category_id, COUNT(*) AS n FROM messages
       WHERE seen = 0 AND category_id IS NOT NULL AND archived_at_ms IS NULL
       GROUP BY category_id`
    )
    .all() as { category_id: string; n: number }[]
  const categoryUnread: Record<string, number> = {}
  for (const r of categoryRows) categoryUnread[r.category_id] = r.n
  const otherRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM messages
       WHERE seen = 0 AND category_id IS NULL AND categorized_at IS NOT NULL
         AND archived_at_ms IS NULL`
    )
    .get() as { n: number }
  const otherUnread = otherRow.n
  let todoTotal = 0
  if (todoCategoryIds.length > 0) {
    const placeholders = todoCategoryIds.map(() => '?').join(',')
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages
         WHERE category_id IN (${placeholders}) AND archived_at_ms IS NULL`
      )
      .get(...todoCategoryIds) as { n: number }
    todoTotal = row.n
  }
  const archiveUnread: Record<string, number> = {}
  let archiveUnreadTotal = 0
  const archiveRows = db
    .prepare(
      `SELECT account_id, COUNT(*) AS n FROM messages
       WHERE seen = 0 AND archived_at_ms IS NOT NULL
       GROUP BY account_id`
    )
    .all() as { account_id: string; n: number }[]
  for (const r of archiveRows) {
    archiveUnread[r.account_id] = r.n
    archiveUnreadTotal += r.n
  }
  return {
    inboxUnread,
    inboxUnreadTotal,
    categoryUnread,
    otherUnread,
    todoTotal,
    archiveUnread,
    archiveUnreadTotal
  }
}

export function listMessages(query: MessagesQuery): Message[] {
  const db = getDb()
  const limit = Math.min(query.limit ?? 200, 1000)
  const where: string[] = []
  const params: (string | number)[] = []
  if (query.accountId) {
    where.push('account_id = ?')
    params.push(query.accountId)
  }
  if (query.categoryId) {
    where.push('category_id = ?')
    where.push('archived_at_ms IS NULL')
    params.push(query.categoryId)
  } else if (query.inbox) {
    where.push('archived_at_ms IS NULL')
  } else if (query.other) {
    where.push('category_id IS NULL AND categorized_at IS NOT NULL AND archived_at_ms IS NULL')
  } else if (query.archived) {
    where.push('archived_at_ms IS NOT NULL')
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const rows = db
    .prepare(`SELECT * FROM messages ${whereSql} ORDER BY date_ms DESC LIMIT ?`)
    .all(...params, limit) as MessageRow[]
  return rows.map(rowToMessage)
}

/**
 * Assign (or clear, when `categoryId` is null) the category for a message.
 * Also stamps `categorized_at` so the UI can distinguish "never categorized"
 * from an explicit "no matching category" (`category_id = NULL`) decision.
 */
export function setCategory(accountId: string, uid: number, categoryId: string | null): boolean {
  const db = getDb()
  const result = db
    .prepare(
      `UPDATE messages SET category_id = ?, categorized_at = ? WHERE account_id = ? AND uid = ?`
    )
    .run(categoryId, Date.now(), accountId, uid)
  return result.changes > 0
}

/**
 * Persist the AI-generated summary for a message. Empty strings are stored
 * as NULL so the renderer can fall back to the built-in snippet.
 */
export function setAiSummary(accountId: string, uid: number, summary: string | null): boolean {
  const db = getDb()
  const value = summary && summary.trim() ? summary : null
  const result = db
    .prepare(`UPDATE messages SET ai_summary = ? WHERE account_id = ? AND uid = ?`)
    .run(value, accountId, uid)
  return result.changes > 0
}

export function getMessage(accountId: string, uid: number): MessageWithBody | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT * FROM messages WHERE account_id = ? AND uid = ? ORDER BY uid_validity DESC LIMIT 1`
    )
    .get(accountId, uid) as MessageRowWithBody | undefined
  if (!row) return null
  const attachmentRows = db
    .prepare(
      `SELECT content_id, mime, bytes FROM inline_attachments
       WHERE account_id = ? AND uid_validity = ? AND uid = ?`
    )
    .all(accountId, row.uid_validity, uid) as {
    content_id: string
    mime: string
    bytes: Buffer
  }[]
  const inlineAttachments: InlineAttachment[] = attachmentRows.map((r) => ({
    contentId: r.content_id,
    mime: r.mime,
    dataBase64: r.bytes.toString('base64')
  }))
  return {
    ...rowToMessage(row),
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    inlineAttachments
  }
}

/**
 * Refs for messages that haven't been reviewed by the AI yet
 * (`categorized_at IS NULL`), newest first. Archived messages are included —
 * we want AI data for them too, and archiving preserves row fields other than
 * `archived_at_ms`. Capped by `limit` to bound per-pass API usage.
 */
export function listUncategorizedRefs(limit: number): { accountId: string; uid: number }[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT account_id, uid FROM messages
       WHERE categorized_at IS NULL
       ORDER BY date_ms DESC LIMIT ?`
    )
    .all(limit) as { account_id: string; uid: number }[]
  return rows.map((r) => ({ accountId: r.account_id, uid: r.uid }))
}

export function listLocalUids(accountId: string, uidValidity: number): number[] {
  const db = getDb()
  const rows = db
    .prepare(`SELECT uid FROM messages WHERE account_id = ? AND uid_validity = ?`)
    .all(accountId, uidValidity) as { uid: number }[]
  return rows.map((r) => r.uid)
}

export type UpsertInlineAttachment = {
  contentId: string
  mime: string
  bytes: Buffer
}

export type UpsertMessage = {
  accountId: string
  uidValidity: number
  uid: number
  messageId: string | null
  subject: string | null
  from: EmailAddress | null
  to: EmailAddress[]
  cc: EmailAddress[]
  dateMs: number
  flags: string[]
  snippet: string | null
  bodyText: string | null
  bodyHtml: string | null
  inlineAttachments: UpsertInlineAttachment[]
}

const INSERT_SQL = `
INSERT INTO messages (
  account_id, uid_validity, uid, message_id, subject,
  from_name, from_address, to_json, cc_json,
  date_ms, flags_json, seen, flagged, snippet,
  body_text, body_html, fetched_at_ms
) VALUES (
  @accountId, @uidValidity, @uid, @messageId, @subject,
  @fromName, @fromAddress, @toJson, @ccJson,
  @dateMs, @flagsJson, @seen, @flagged, @snippet,
  @bodyText, @bodyHtml, @fetchedAtMs
)
ON CONFLICT (account_id, uid_validity, uid) DO UPDATE SET
  message_id = excluded.message_id,
  subject = excluded.subject,
  from_name = excluded.from_name,
  from_address = excluded.from_address,
  to_json = excluded.to_json,
  cc_json = excluded.cc_json,
  date_ms = excluded.date_ms,
  flags_json = excluded.flags_json,
  seen = excluded.seen,
  flagged = excluded.flagged,
  snippet = excluded.snippet,
  body_text = excluded.body_text,
  body_html = excluded.body_html,
  fetched_at_ms = excluded.fetched_at_ms
`

export function upsertMessages(messages: UpsertMessage[]): void {
  if (messages.length === 0) return
  const db = getDb()
  const stmt = db.prepare(INSERT_SQL)
  const deleteAttachments = db.prepare(
    `DELETE FROM inline_attachments WHERE account_id = ? AND uid_validity = ? AND uid = ?`
  )
  const insertAttachment = db.prepare(
    `INSERT OR REPLACE INTO inline_attachments
       (account_id, uid_validity, uid, content_id, mime, bytes)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const now = Date.now()
  const tx = db.transaction((items: UpsertMessage[]) => {
    for (const m of items) {
      stmt.run({
        accountId: m.accountId,
        uidValidity: m.uidValidity,
        uid: m.uid,
        messageId: m.messageId,
        subject: m.subject,
        fromName: m.from?.name ?? null,
        fromAddress: m.from?.address ?? null,
        toJson: JSON.stringify(m.to),
        ccJson: JSON.stringify(m.cc),
        dateMs: m.dateMs,
        flagsJson: JSON.stringify(m.flags),
        seen: m.flags.includes('\\Seen') ? 1 : 0,
        flagged: m.flags.includes('\\Flagged') ? 1 : 0,
        snippet: m.snippet,
        bodyText: m.bodyText,
        bodyHtml: m.bodyHtml,
        fetchedAtMs: now
      })
      // Replace inline attachments for this message.
      deleteAttachments.run(m.accountId, m.uidValidity, m.uid)
      for (const a of m.inlineAttachments) {
        insertAttachment.run(m.accountId, m.uidValidity, m.uid, a.contentId, a.mime, a.bytes)
      }
    }
  })
  tx(messages)
}

export function updateFlags(
  accountId: string,
  uidValidity: number,
  updates: { uid: number; flags: string[] }[]
): void {
  if (updates.length === 0) return
  const db = getDb()
  const stmt = db.prepare(
    `UPDATE messages SET flags_json = ?, seen = ?, flagged = ?
     WHERE account_id = ? AND uid_validity = ? AND uid = ?`
  )
  const tx = db.transaction((items: { uid: number; flags: string[] }[]) => {
    for (const { uid, flags } of items) {
      stmt.run(
        JSON.stringify(flags),
        flags.includes('\\Seen') ? 1 : 0,
        flags.includes('\\Flagged') ? 1 : 0,
        accountId,
        uidValidity,
        uid
      )
    }
  })
  tx(updates)
}

/**
 * Flip the `\Seen` flag locally for a single message, returning true if the
 * row existed and the value actually changed. Used for optimistic UI updates
 * — the IMAP round-trip happens in parallel and is reconciled on next sync.
 */
export function setSeenLocal(accountId: string, uid: number, seen: boolean): boolean {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT uid_validity, flags_json, seen FROM messages
       WHERE account_id = ? AND uid = ? ORDER BY uid_validity DESC LIMIT 1`
    )
    .get(accountId, uid) as { uid_validity: number; flags_json: string; seen: number } | undefined
  if (!row) return false
  if ((row.seen === 1) === seen) return false

  const flags = parseFlags(row.flags_json)
  const hasSeen = flags.includes('\\Seen')
  const nextFlags = seen
    ? hasSeen
      ? flags
      : [...flags, '\\Seen']
    : flags.filter((f) => f !== '\\Seen')

  db.prepare(
    `UPDATE messages SET flags_json = ?, seen = ?
     WHERE account_id = ? AND uid_validity = ? AND uid = ?`
  ).run(JSON.stringify(nextFlags), seen ? 1 : 0, accountId, row.uid_validity, uid)
  return true
}

/**
 * Stamp `archived_at_ms` locally so the UI can move the message to the
 * Archived view before the IMAP move completes. Returns true if the row
 * existed and wasn't already archived.
 */
export function setArchivedLocal(accountId: string, uid: number, archivedAt: number): boolean {
  const db = getDb()
  const result = db
    .prepare(
      `UPDATE messages SET archived_at_ms = ?
       WHERE account_id = ? AND uid = ? AND archived_at_ms IS NULL`
    )
    .run(archivedAt, accountId, uid)
  return result.changes > 0
}

/**
 * Clear `archived_at_ms` locally. Used by the unarchive optimistic path so
 * the list views move the message back to its inbox bucket before the IMAP
 * round-trip completes.
 */
export function clearArchivedLocal(accountId: string, uid: number): boolean {
  const db = getDb()
  const result = db
    .prepare(
      `UPDATE messages SET archived_at_ms = NULL
       WHERE account_id = ? AND uid = ? AND archived_at_ms IS NOT NULL`
    )
    .run(accountId, uid)
  return result.changes > 0
}

/** Return the RFC 5322 Message-Id of a cached message, if we have it. */
export function getMessageId(accountId: string, uid: number): string | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT message_id FROM messages
       WHERE account_id = ? AND uid = ? ORDER BY uid_validity DESC LIMIT 1`
    )
    .get(accountId, uid) as { message_id: string | null } | undefined
  return row?.message_id ?? null
}

/**
 * Remove a single message row plus its inline attachments. Used after the
 * IMAP move on unarchive — the row still holds the pre-move INBOX UID, which
 * would otherwise get re-archived by `reconcileInbox` on the next pass.
 */
export function deleteMessage(accountId: string, uid: number): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare(`DELETE FROM inline_attachments WHERE account_id = ? AND uid = ?`).run(
      accountId,
      uid
    )
    db.prepare(`DELETE FROM messages WHERE account_id = ? AND uid = ?`).run(accountId, uid)
  })()
}

export type ReconcileResult = {
  /** Rows newly marked as archived on this pass. */
  archived: number
  /** Rows whose archived flag was cleared (reappeared in INBOX). */
  unarchived: number
  /** Rows deleted (archived too long ago, or older than `syncFromMs`). */
  deleted: number
}

/**
 * Reconcile local cache against the server's current INBOX listing.
 *
 * - Messages present in INBOX get `archived_at_ms` cleared (if set).
 * - Messages no longer in INBOX (but still newer than `syncFromMs`) are
 *   marked as archived with the current timestamp. Already-archived rows
 *   keep their original stamp so we don't restart the countdown.
 * - Rows whose `archived_at_ms < now - archiveRetentionMs` are deleted.
 * - Rows whose `date_ms < syncFromMs` are always deleted (out of scope).
 */
export function reconcileInbox(params: {
  accountId: string
  uidValidity: number
  serverUids: number[]
  syncFromMs: number
  archiveRetentionMs: number
  now: number
}): ReconcileResult {
  const { accountId, uidValidity, serverUids, syncFromMs, archiveRetentionMs, now } = params
  const db = getDb()
  const archiveCutoff = now - archiveRetentionMs
  const tx = db.transaction(() => {
    db.exec('CREATE TEMP TABLE IF NOT EXISTS _server_uids (uid INTEGER PRIMARY KEY)')
    db.exec('DELETE FROM _server_uids')
    if (serverUids.length > 0) {
      const ins = db.prepare('INSERT OR IGNORE INTO _server_uids (uid) VALUES (?)')
      for (const uid of serverUids) ins.run(uid)
    }

    const unarchived = db
      .prepare(
        `UPDATE messages
         SET archived_at_ms = NULL
         WHERE account_id = ? AND uid_validity = ?
           AND archived_at_ms IS NOT NULL
           AND uid IN (SELECT uid FROM _server_uids)`
      )
      .run(accountId, uidValidity).changes

    const archived = db
      .prepare(
        `UPDATE messages
         SET archived_at_ms = ?
         WHERE account_id = ? AND uid_validity = ?
           AND archived_at_ms IS NULL
           AND date_ms >= ?
           AND uid NOT IN (SELECT uid FROM _server_uids)`
      )
      .run(now, accountId, uidValidity, syncFromMs).changes

    db.prepare(
      `DELETE FROM inline_attachments
       WHERE account_id = ? AND uid_validity = ?
         AND uid IN (
           SELECT uid FROM messages
           WHERE account_id = ? AND uid_validity = ?
             AND ((archived_at_ms IS NOT NULL AND archived_at_ms < ?) OR date_ms < ?)
         )`
    ).run(accountId, uidValidity, accountId, uidValidity, archiveCutoff, syncFromMs)
    const deleted = db
      .prepare(
        `DELETE FROM messages
         WHERE account_id = ? AND uid_validity = ?
           AND ((archived_at_ms IS NOT NULL AND archived_at_ms < ?) OR date_ms < ?)`
      )
      .run(accountId, uidValidity, archiveCutoff, syncFromMs).changes

    db.exec('DELETE FROM _server_uids')
    return { archived, unarchived, deleted }
  })
  return tx()
}

export function deleteAllForAccount(accountId: string): void {
  const db = getDb()
  db.prepare(`DELETE FROM inline_attachments WHERE account_id = ?`).run(accountId)
  db.prepare(`DELETE FROM messages WHERE account_id = ?`).run(accountId)
  db.prepare(`DELETE FROM account_sync_state WHERE account_id = ?`).run(accountId)
}

/**
 * Global pre-sync cleanup. Removes messages that fell out of the sync window
 * (older than `syncFromMs`) and archived copies whose retention has expired.
 * Run across all accounts, independent of any ongoing IMAP fetch.
 */
export function prunePermanent(syncFromMs: number, archiveRetentionMs: number): number {
  const db = getDb()
  const archiveCutoff = Date.now() - archiveRetentionMs
  db.prepare(
    `DELETE FROM inline_attachments
     WHERE (account_id, uid_validity, uid) IN
       (SELECT account_id, uid_validity, uid FROM messages
        WHERE date_ms < ?
           OR (archived_at_ms IS NOT NULL AND archived_at_ms < ?))`
  ).run(syncFromMs, archiveCutoff)
  const result = db
    .prepare(
      `DELETE FROM messages
       WHERE date_ms < ?
          OR (archived_at_ms IS NOT NULL AND archived_at_ms < ?)`
    )
    .run(syncFromMs, archiveCutoff)
  return result.changes
}

export function getSyncState(accountId: string): {
  uidValidity: number | null
  lastSyncMs: number | null
} {
  const db = getDb()
  const row = db
    .prepare(`SELECT uid_validity, last_sync_ms FROM account_sync_state WHERE account_id = ?`)
    .get(accountId) as { uid_validity: number | null; last_sync_ms: number | null } | undefined
  if (!row) return { uidValidity: null, lastSyncMs: null }
  return { uidValidity: row.uid_validity, lastSyncMs: row.last_sync_ms }
}

export function setSyncState(accountId: string, uidValidity: number, lastSyncMs: number): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO account_sync_state (account_id, uid_validity, last_sync_ms)
     VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET uid_validity = excluded.uid_validity,
                                            last_sync_ms = excluded.last_sync_ms`
  ).run(accountId, uidValidity, lastSyncMs)
}
