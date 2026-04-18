import type { Contact, EmailAddress } from '../shared/settings'
import { getDb } from './db'

type ContactRow = {
  account_id: string
  address: string
  display_name: string | null
  first_seen_ms: number
  last_seen_ms: number
  sent_count: number
  received_count: number
}

export type ContactSeen = {
  /** Display name as it appeared on this message. `null` if only the bare address was seen. */
  name: string | null
  /** Case-insensitive address. Normalized (lowercased, trimmed) before write. */
  address: string
  /** Did this address appear as a recipient (sent) or the sender (received)? */
  direction: 'sent' | 'received'
  /** Epoch ms of the message this sighting came from. */
  dateMs: number
}

const UPSERT_SQL = `
INSERT INTO contacts (
  account_id, address, display_name,
  first_seen_ms, last_seen_ms, sent_count, received_count
) VALUES (
  @accountId, @address, @displayName,
  @dateMs, @dateMs, @sent, @received
)
ON CONFLICT (account_id, address) DO UPDATE SET
  -- Keep the oldest first-seen, newest last-seen.
  first_seen_ms = MIN(first_seen_ms, excluded.first_seen_ms),
  last_seen_ms  = MAX(last_seen_ms,  excluded.last_seen_ms),
  sent_count     = sent_count     + excluded.sent_count,
  received_count = received_count + excluded.received_count,
  -- Only replace the display name when the new sighting is more recent AND
  -- carries a non-empty name — avoids clobbering a good name with a later
  -- bare-address sighting.
  display_name = CASE
    WHEN excluded.display_name IS NOT NULL
     AND excluded.display_name <> ''
     AND excluded.last_seen_ms >= contacts.last_seen_ms
    THEN excluded.display_name
    ELSE contacts.display_name
  END
`

function normalize(address: string): string | null {
  const trimmed = address.trim().toLowerCase()
  if (!trimmed.includes('@')) return null
  return trimmed
}

function cleanName(name: string | null | undefined): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  // Drop names that are just the email address repeated — offers no signal.
  if (trimmed.toLowerCase() === name.toLowerCase() && trimmed.includes('@')) return null
  return trimmed
}

/**
 * Record one or more address sightings. Called from imap-sync when new
 * messages land and from smtp-send after a successful send. Silently skips
 * malformed addresses. Safe to call inside an existing transaction.
 */
export function recordSightings(accountId: string, sightings: ContactSeen[]): void {
  if (sightings.length === 0) return
  const db = getDb()
  const stmt = db.prepare(UPSERT_SQL)
  const tx = db.transaction((items: ContactSeen[]) => {
    for (const s of items) {
      const address = normalize(s.address)
      if (!address) continue
      stmt.run({
        accountId,
        address,
        displayName: cleanName(s.name),
        dateMs: s.dateMs,
        sent: s.direction === 'sent' ? 1 : 0,
        received: s.direction === 'received' ? 1 : 0
      })
    }
  })
  tx(sightings)
}

/** Convenience: record the addresses carried by a single message. */
export function recordMessageAddresses(params: {
  accountId: string
  ownEmail: string
  from: EmailAddress | null
  to: EmailAddress[]
  cc: EmailAddress[]
  dateMs: number
  /**
   * Was this message sent by the account owner (SMTP / Sent folder) or
   * received in the INBOX? Determines whether `to`/`cc` counts as "sent" or
   * "received" for ranking.
   */
  fromOwner: boolean
}): void {
  const { accountId, ownEmail, from, to, cc, dateMs, fromOwner } = params
  const ownLc = ownEmail.toLowerCase()
  const sightings: ContactSeen[] = []
  if (fromOwner) {
    // We're the sender — credit each recipient with a "sent" hit.
    for (const addr of [...to, ...cc]) {
      if (addr.address.toLowerCase() === ownLc) continue
      sightings.push({ name: addr.name, address: addr.address, direction: 'sent', dateMs })
    }
  } else {
    // We received this — the `from` address gets "received", and any
    // other recipients get a received hit too so people we share threads
    // with still end up in the address book.
    if (from && from.address.toLowerCase() !== ownLc) {
      sightings.push({ name: from.name, address: from.address, direction: 'received', dateMs })
    }
    for (const addr of [...to, ...cc]) {
      if (addr.address.toLowerCase() === ownLc) continue
      sightings.push({ name: addr.name, address: addr.address, direction: 'received', dateMs })
    }
  }
  recordSightings(accountId, sightings)
}

/**
 * Autocomplete lookup. Matches `query` (case-insensitive) against either
 * the local-part / domain of the address or the display name, sorted by a
 * blend of recency and total interaction count.
 *
 * Merges two sources:
 *  1. `contacts`  — derived from every synced / sent message (per-account).
 *  2. `mac_contacts` — imported from the macOS Contacts app.
 *
 * The user's Mac address book is authoritative for names: if an address
 * appears in both tables, we return the Mac name and flag `fromMacContacts`.
 * Mac contacts that the user has never emailed still appear in the list so
 * the first email to someone auto-completes off their address book — those
 * come back with the `__macos__` sentinel `accountId` and zero counters.
 *
 * Empty query returns the top `limit` most-recent contacts.
 */
export function searchContacts(params: {
  accountId?: string
  query: string
  limit?: number
}): Contact[] {
  const db = getDb()
  const limit = Math.min(params.limit ?? 20, 100)
  const q = params.query.trim().toLowerCase()
  const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null

  // -------------------------------------------------------------------------
  // Derived contacts, with the Mac name taking priority on matches.
  // -------------------------------------------------------------------------
  const derivedWhere: string[] = []
  const derivedValues: (string | number)[] = []
  if (params.accountId) {
    derivedWhere.push('c.account_id = ?')
    derivedValues.push(params.accountId)
  }
  if (pattern) {
    // Filter against the *effective* name (Mac first, then derived) so a
    // search for "Paz" still hits an address whose derived name is
    // "Mamá de XX" but whose Mac name is "Paz Godoy".
    derivedWhere.push(
      `(c.address LIKE ? ESCAPE '\\' ` +
        `OR lower(COALESCE(m.display_name, c.display_name)) LIKE ? ESCAPE '\\')`
    )
    derivedValues.push(pattern, pattern)
  }
  const derivedWhereSql = derivedWhere.length > 0 ? `WHERE ${derivedWhere.join(' AND ')}` : ''

  const derivedRows = db
    .prepare(
      `SELECT
         c.account_id, c.address,
         COALESCE(m.display_name, c.display_name) AS display_name,
         c.first_seen_ms, c.last_seen_ms,
         c.sent_count, c.received_count,
         CASE WHEN m.address IS NOT NULL THEN 1 ELSE 0 END AS from_mac
       FROM contacts c
       LEFT JOIN mac_contacts m ON m.address = c.address
       ${derivedWhereSql}
       ORDER BY c.last_seen_ms DESC, (c.sent_count + c.received_count) DESC
       LIMIT ?`
    )
    .all(...derivedValues, limit) as (ContactRow & { from_mac: number })[]

  const results: Contact[] = derivedRows.map((row) => ({
    accountId: row.account_id,
    address: row.address,
    displayName: row.display_name,
    firstSeenMs: row.first_seen_ms,
    lastSeenMs: row.last_seen_ms,
    sentCount: row.sent_count,
    receivedCount: row.received_count,
    fromMacContacts: row.from_mac === 1
  }))

  // -------------------------------------------------------------------------
  // Mac-only contacts (addresses the user has never emailed with). Only
  // fill up the remaining budget so derived results always win visibility.
  // -------------------------------------------------------------------------
  const remaining = limit - results.length
  if (remaining > 0) {
    const seen = new Set(results.map((r) => r.address))
    const macWhere: string[] = []
    const macValues: (string | number)[] = []
    if (pattern) {
      macWhere.push(`(address LIKE ? ESCAPE '\\' OR lower(display_name) LIKE ? ESCAPE '\\')`)
      macValues.push(pattern, pattern)
    }
    const macWhereSql = macWhere.length > 0 ? `WHERE ${macWhere.join(' AND ')}` : ''
    type MacRow = {
      address: string
      display_name: string
      imported_at_ms: number
    }
    const macRows = db
      .prepare(
        `SELECT address, display_name, imported_at_ms
         FROM mac_contacts ${macWhereSql}
         ORDER BY lower(display_name) ASC
         LIMIT ?`
      )
      .all(...macValues, remaining + seen.size) as MacRow[]
    for (const m of macRows) {
      if (seen.has(m.address)) continue
      results.push({
        accountId: '__macos__',
        address: m.address,
        displayName: m.display_name,
        firstSeenMs: m.imported_at_ms,
        lastSeenMs: m.imported_at_ms,
        sentCount: 0,
        receivedCount: 0,
        fromMacContacts: true
      })
      if (results.length >= limit) break
    }
  }

  return results
}

/**
 * Returns true if the contacts table is empty (fresh install or pre-feature
 * user DB). The caller uses this to decide whether to run the one-shot
 * backfill from existing cached messages.
 */
export function isEmpty(): boolean {
  const db = getDb()
  const row = db.prepare(`SELECT 1 AS n FROM contacts LIMIT 1`).get() as { n: number } | undefined
  return !row
}

/**
 * One-shot backfill: walk the whole `messages` table and populate `contacts`.
 * Assumes `isEmpty()` was true — the upserts are additive, but running this
 * twice would double-count.
 *
 * `accountsByEmail` lets us determine whether a given message was sent by the
 * account owner (From = ownEmail → 'sent' direction) or received.
 */
export function backfillFromMessages(
  accountsByEmail: Map<string, { id: string; email: string }>
): number {
  const db = getDb()
  type Row = {
    account_id: string
    from_name: string | null
    from_address: string | null
    to_json: string
    cc_json: string
    date_ms: number
  }
  const rows = db
    .prepare(`SELECT account_id, from_name, from_address, to_json, cc_json, date_ms FROM messages`)
    .all() as Row[]
  let touched = 0
  const byAccount = new Map<string, ContactSeen[]>()
  for (const row of rows) {
    const account = Array.from(accountsByEmail.values()).find((a) => a.id === row.account_id)
    if (!account) continue
    const ownLc = account.email.toLowerCase()
    const fromOwner = row.from_address != null && row.from_address.toLowerCase() === ownLc
    const to = safeParseAddresses(row.to_json)
    const cc = safeParseAddresses(row.cc_json)
    const sightings: ContactSeen[] = []
    if (fromOwner) {
      for (const addr of [...to, ...cc]) {
        if (addr.address.toLowerCase() === ownLc) continue
        sightings.push({
          name: addr.name,
          address: addr.address,
          direction: 'sent',
          dateMs: row.date_ms
        })
      }
    } else {
      if (row.from_address && row.from_address.toLowerCase() !== ownLc) {
        sightings.push({
          name: row.from_name,
          address: row.from_address,
          direction: 'received',
          dateMs: row.date_ms
        })
      }
      for (const addr of [...to, ...cc]) {
        if (addr.address.toLowerCase() === ownLc) continue
        sightings.push({
          name: addr.name,
          address: addr.address,
          direction: 'received',
          dateMs: row.date_ms
        })
      }
    }
    if (sightings.length === 0) continue
    const bucket = byAccount.get(row.account_id)
    if (bucket) bucket.push(...sightings)
    else byAccount.set(row.account_id, sightings)
    touched += sightings.length
  }
  for (const [accountId, sightings] of byAccount) {
    recordSightings(accountId, sightings)
  }
  return touched
}

function safeParseAddresses(json: string): EmailAddress[] {
  try {
    const parsed = JSON.parse(json) as EmailAddress[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Drop every contact belonging to an account. Used on account removal. */
export function deleteAllForAccount(accountId: string): void {
  const db = getDb()
  db.prepare(`DELETE FROM contacts WHERE account_id = ?`).run(accountId)
}
