/**
 * The cloud-side schema for Mail Samurai. The cloud DB (Turso / libSQL)
 * hosts three tables:
 *
 *  1. `events` — append-only log of changes to per-message state (category,
 *     AI summary). Each device keeps a local cursor of the largest `id` it
 *     has consumed and pulls `WHERE id > cursor` on every sync. Events are
 *     immutable; new writes become new rows. GC runs on every insert —
 *     anything older than `EVENT_TTL_MS` is deleted in the same round-trip.
 *
 *  2. `categories` — snapshot of the user's category definitions. Small and
 *     stable, so LWW by `updated_at` is enough; we don't need to log each
 *     rename as an event.
 *
 *  3. `kv` — a bag of small shared settings (uncategorizedAction,
 *     summaryLanguage). Same LWW model as categories.
 *
 * Email bodies, IMAP flags, credentials, AI API keys — none of that ever
 * leaves the device. The cloud DB only holds what the user wants to share
 * across devices, keyed by the RFC 5322 Message-Id.
 */

import type {
  Category,
  CategoryAction,
  CategoryCountMode,
  CategoryIcon,
  SummaryLanguage
} from '../shared/settings'
import { type LibsqlCredentials, libsqlQuery, libsqlRows } from './libsql-client'

/** 90 days. Events older than this are GC'd on every insert. */
export const EVENT_TTL_MS = 90 * 24 * 60 * 60 * 1000

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     type TEXT NOT NULL,
     payload_json TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at)`,
  `CREATE TABLE IF NOT EXISTS categories (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     instructions TEXT NOT NULL,
     action_json TEXT NOT NULL,
     icon TEXT NOT NULL,
     count_mode TEXT NOT NULL,
     position INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     deleted_at INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS kv (
     key TEXT PRIMARY KEY,
     value_json TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   )`
]

export async function bootstrapCloudSchema(creds: LibsqlCredentials): Promise<void> {
  await libsqlQuery(
    creds,
    SCHEMA_STATEMENTS.map((sql) => ({ sql, params: [] }))
  )
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Payloads currently understood. Extend this union as new event kinds appear. */
export type OverlaySetPayload = {
  messageId: string
  categoryId: string | null
  aiSummary: string | null
  categorizedAt: number
}

export type CloudEvent = {
  id: number
  type: 'overlay.set'
  payload: OverlaySetPayload
  createdAt: number
}

/**
 * Insert one event. Same round-trip also sweeps anything older than
 * `EVENT_TTL_MS` so the cloud DB stays small without external cron.
 */
export async function appendEvent(
  creds: LibsqlCredentials,
  type: CloudEvent['type'],
  payload: OverlaySetPayload,
  createdAt: number
): Promise<void> {
  const cutoff = createdAt - EVENT_TTL_MS
  await libsqlQuery(creds, [
    {
      sql: 'INSERT INTO events (type, payload_json, created_at) VALUES (?, ?, ?)',
      params: [type, JSON.stringify(payload), createdAt]
    },
    {
      sql: 'DELETE FROM events WHERE created_at < ?',
      params: [cutoff]
    }
  ])
}

/**
 * Bulk-insert many events in one request. Used by the initial backfill on
 * connect to upload every locally-categorized message at once. D1 accepts
 * arrays of statements up to a server-side cap (~1 MB per request); callers
 * that might exceed it should batch themselves.
 */
export async function appendEventsBatch(
  creds: LibsqlCredentials,
  events: { type: CloudEvent['type']; payload: OverlaySetPayload; createdAt: number }[]
): Promise<void> {
  if (events.length === 0) return
  const cutoff = Date.now() - EVENT_TTL_MS
  const statements: { sql: string; params: unknown[] }[] = events.map((ev) => ({
    sql: 'INSERT INTO events (type, payload_json, created_at) VALUES (?, ?, ?)',
    params: [ev.type, JSON.stringify(ev.payload), ev.createdAt]
  }))
  // Run GC once at the end of the batch — no need to repeat it per row.
  statements.push({
    sql: 'DELETE FROM events WHERE created_at < ?',
    params: [cutoff]
  })
  await libsqlQuery(creds, statements)
}

/**
 * Pull the slice of the log this device hasn't seen yet. Results are sorted
 * by `id ASC` so callers can apply them in commit order and then advance
 * their cursor to the max id returned.
 */
export async function pullEventsSince(
  creds: LibsqlCredentials,
  cursor: number,
  limit = 5000
): Promise<CloudEvent[]> {
  type Row = {
    id: number
    type: string
    payload_json: string
    created_at: number
  }
  const rows = await libsqlRows<Row>(
    creds,
    'SELECT id, type, payload_json, created_at FROM events WHERE id > ? ORDER BY id ASC LIMIT ?',
    [cursor, limit]
  )
  const out: CloudEvent[] = []
  for (const row of rows) {
    if (row.type !== 'overlay.set') continue // forward-compat: skip unknown types
    try {
      const payload = JSON.parse(row.payload_json) as OverlaySetPayload
      out.push({
        id: row.id,
        type: 'overlay.set',
        payload,
        createdAt: row.created_at
      })
    } catch {
      // Corrupt payload — skip, don't block the cursor.
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Categories (definitions) — synced between devices
// ---------------------------------------------------------------------------

export type CloudCategoryRow = {
  category: Category
  position: number
  updatedAt: number
  deletedAt: number | null
}

type CategoryRow = {
  id: string
  name: string
  instructions: string
  action_json: string
  icon: string
  count_mode: string
  position: number
  updated_at: number
  deleted_at: number | null
}

function rowToCategory(row: CategoryRow): CloudCategoryRow | null {
  let action: CategoryAction
  try {
    action = JSON.parse(row.action_json) as CategoryAction
  } catch {
    action = { kind: 'none' }
  }
  return {
    category: {
      id: row.id,
      name: row.name,
      instructions: row.instructions,
      action,
      icon: row.icon as CategoryIcon,
      countMode: row.count_mode as CategoryCountMode
    },
    position: row.position,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  }
}

export async function pullCategories(creds: LibsqlCredentials): Promise<CloudCategoryRow[]> {
  const rows = await libsqlRows<CategoryRow>(
    creds,
    'SELECT id, name, instructions, action_json, icon, count_mode, position, updated_at, deleted_at FROM categories ORDER BY position ASC'
  )
  return rows.map(rowToCategory).filter((r): r is CloudCategoryRow => r !== null)
}

export async function pushCategories(
  creds: LibsqlCredentials,
  categories: Category[],
  updatedAt: number
): Promise<void> {
  if (categories.length === 0) return
  const statements = categories.map((category, index) => ({
    sql: `INSERT INTO categories (id, name, instructions, action_json, icon, count_mode, position, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            instructions = excluded.instructions,
            action_json = excluded.action_json,
            icon = excluded.icon,
            count_mode = excluded.count_mode,
            position = excluded.position,
            updated_at = excluded.updated_at,
            deleted_at = NULL
          WHERE excluded.updated_at >= categories.updated_at`,
    params: [
      category.id,
      category.name,
      category.instructions,
      JSON.stringify(category.action),
      category.icon,
      category.countMode,
      index,
      updatedAt
    ]
  }))
  await libsqlQuery(creds, statements)
}

export async function softDeleteCategory(
  creds: LibsqlCredentials,
  id: string,
  deletedAt: number
): Promise<void> {
  await libsqlQuery(creds, {
    sql: 'UPDATE categories SET deleted_at = ?, updated_at = ? WHERE id = ?',
    params: [deletedAt, deletedAt, id]
  })
}

// ---------------------------------------------------------------------------
// Key-value settings
// ---------------------------------------------------------------------------

type KvRow = { key: string; value_json: string; updated_at: number }

export type CloudKvEntry<T> = { value: T; updatedAt: number }

export async function pushKv<T>(
  creds: LibsqlCredentials,
  key: string,
  value: T,
  updatedAt: number
): Promise<void> {
  await libsqlQuery(creds, {
    sql: `INSERT INTO kv (key, value_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
          WHERE excluded.updated_at >= kv.updated_at`,
    params: [key, JSON.stringify(value), updatedAt]
  })
}

export async function pullKv<T>(
  creds: LibsqlCredentials,
  key: string
): Promise<CloudKvEntry<T> | null> {
  const rows = await libsqlRows<KvRow>(
    creds,
    'SELECT key, value_json, updated_at FROM kv WHERE key = ? LIMIT 1',
    [key]
  )
  const row = rows[0]
  if (!row) return null
  try {
    return { value: JSON.parse(row.value_json) as T, updatedAt: row.updated_at }
  } catch {
    return null
  }
}

export const KV_KEYS = {
  uncategorizedAction: 'settings.uncategorizedAction',
  summaryLanguage: 'settings.summaryLanguage'
} as const

export type SyncedKv = {
  uncategorizedAction: CategoryAction
  summaryLanguage: SummaryLanguage
}
