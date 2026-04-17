import type {
  EmailAddress,
  InlineAttachment,
  Message,
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
    snippet: row.snippet
  }
}

export function listMessages(query: MessagesQuery): Message[] {
  const db = getDb()
  const limit = Math.min(query.limit ?? 200, 1000)
  const rows = query.accountId
    ? (db
        .prepare(`SELECT * FROM messages WHERE account_id = ? ORDER BY date_ms DESC LIMIT ?`)
        .all(query.accountId, limit) as MessageRow[])
    : (db
        .prepare(`SELECT * FROM messages ORDER BY date_ms DESC LIMIT ?`)
        .all(limit) as MessageRow[])
  return rows.map(rowToMessage)
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

export function deleteMissing(
  accountId: string,
  uidValidity: number,
  keepUids: number[],
  cutoffMs: number
): number {
  const db = getDb()
  // SQLite has a parameter limit; chunk the keep set if necessary.
  // For our retention windows this is generally well under the limit, but be safe.
  const tx = db.transaction(() => {
    let removed = 0
    if (keepUids.length === 0) {
      db.prepare(`DELETE FROM inline_attachments WHERE account_id = ? AND uid_validity = ?`).run(
        accountId,
        uidValidity
      )
      const result = db
        .prepare(`DELETE FROM messages WHERE account_id = ? AND uid_validity = ?`)
        .run(accountId, uidValidity)
      removed += result.changes
    } else {
      // Insert keepUids into a temp table and DELETE WHERE NOT IN.
      db.exec('CREATE TEMP TABLE IF NOT EXISTS _keep_uids (uid INTEGER PRIMARY KEY)')
      db.exec('DELETE FROM _keep_uids')
      const ins = db.prepare('INSERT OR IGNORE INTO _keep_uids (uid) VALUES (?)')
      for (const uid of keepUids) ins.run(uid)
      db.prepare(
        `DELETE FROM inline_attachments
         WHERE account_id = ? AND uid_validity = ?
           AND uid NOT IN (SELECT uid FROM _keep_uids)`
      ).run(accountId, uidValidity)
      const result = db
        .prepare(
          `DELETE FROM messages
           WHERE account_id = ? AND uid_validity = ?
             AND uid NOT IN (SELECT uid FROM _keep_uids)`
        )
        .run(accountId, uidValidity)
      removed += result.changes
      db.exec('DELETE FROM _keep_uids')
    }
    db.prepare(
      `DELETE FROM inline_attachments
       WHERE account_id = ? AND uid_validity = ?
         AND uid IN (SELECT uid FROM messages
                     WHERE account_id = ? AND uid_validity = ? AND date_ms < ?)`
    ).run(accountId, uidValidity, accountId, uidValidity, cutoffMs)
    const oldResult = db
      .prepare(`DELETE FROM messages WHERE account_id = ? AND uid_validity = ? AND date_ms < ?`)
      .run(accountId, uidValidity, cutoffMs)
    removed += oldResult.changes
    return removed
  })
  return tx()
}

export function deleteAllForAccount(accountId: string): void {
  const db = getDb()
  db.prepare(`DELETE FROM inline_attachments WHERE account_id = ?`).run(accountId)
  db.prepare(`DELETE FROM messages WHERE account_id = ?`).run(accountId)
  db.prepare(`DELETE FROM account_sync_state WHERE account_id = ?`).run(accountId)
}

export function pruneOlderThan(cutoffMs: number): number {
  const db = getDb()
  db.prepare(
    `DELETE FROM inline_attachments
     WHERE (account_id, uid_validity, uid) IN
       (SELECT account_id, uid_validity, uid FROM messages WHERE date_ms < ?)`
  ).run(cutoffMs)
  const result = db.prepare(`DELETE FROM messages WHERE date_ms < ?`).run(cutoffMs)
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
