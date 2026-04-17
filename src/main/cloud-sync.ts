/**
 * High-level orchestrator for the Turso (libSQL) cloud sync.
 *
 * Model at a glance:
 *   - Local SQLite is the authoritative source of truth for everything the UI
 *     reads. No query ever waits on a network round-trip.
 *   - the cloud DB holds three things: an append-only `events` log of overlay changes,
 *     a `categories` snapshot, and a `kv` bag of small shared settings.
 *   - Each device keeps a local cursor (`cloud.lastEventId`). Writes emit
 *     events immediately; reads pull `WHERE id > cursor` and advance the
 *     cursor. Old events (>90d) are GC'd on every insert.
 *
 * This file owns:
 *   1. connect — ping, schema bootstrap, full backfill upload, pull all
 *      existing events, merge categories + KV both ways.
 *   2. syncCloudNow — pull events since cursor, apply to local (or buffer
 *      the ones whose target message isn't cached), refresh categories/KV.
 *   3. push* helpers called after every local edit so the change lands in
 *      the event log or in the snapshot tables right away.
 *
 * Every cloud call is wrapped in try/catch so offline / bad credentials
 * never poison the local flow; we log and keep going.
 */

import type {
  Category,
  CategoryAction,
  CloudConfig,
  CloudCredentials,
  SummaryLanguage
} from '../shared/settings'
import { type LibsqlCredentials, libsqlPing } from './libsql-client'
import {
  bufferCloudOverlay,
  drainCloudOverlayBuffer,
  listCategorizedForBackfill,
  listRefsByMessageId,
  setAiSummary,
  setCategory as setLocalCategory
} from './messages-store'
import {
  appendEvent,
  appendEventsBatch,
  bootstrapCloudSchema,
  type CloudCategoryRow,
  type CloudEvent,
  KV_KEYS,
  type OverlaySetPayload,
  pullCategories,
  pullEventsSince,
  pullKv,
  pushCategories,
  pushKv
} from './overlay-store'
import {
  getCloudCredentials,
  getUiSettings,
  setCloudLastEventId,
  setCloudLastSyncedAt,
  disconnectCloud as storeDisconnect,
  setCategories as storeSetCategories,
  setCloudCredentials as storeSetCreds,
  setSummaryLanguage as storeSetSummaryLanguage
} from './settings-store'

/** How many events we batch per HTTPS round-trip during the initial backfill. */
const BACKFILL_CHUNK = 50
/** Upper bound per pull — more than this and we loop to drain the log. */
const PULL_CHUNK = 5000

/** `SELECT 1` ping; used by the Settings "Test connection" button. */
export async function testCloudConnection(creds: CloudCredentials): Promise<void> {
  await libsqlPing({
    databaseUrl: creds.databaseUrl.trim(),
    authToken: creds.authToken
  })
}

/**
 * Connect flow. Persists credentials, bootstraps the schema, pushes category
 * and KV settings up (those are cheap and shared), then pulls whatever the
 * cloud already has. Does **not** upload the local AI history by itself —
 * typical use case is "I ran the analysis on one device and want the rest to
 * consume it"; every device auto-backfilling would waste work and could even
 * race the primary's higher-quality events. Use `pushLocalHistory` when the
 * user explicitly decides this device is the primary.
 */
export async function connectCloud(creds: CloudCredentials): Promise<CloudConfig> {
  const db: LibsqlCredentials = {
    databaseUrl: creds.databaseUrl.trim(),
    authToken: creds.authToken
  }

  // Ping first so bad credentials fail fast, before anything is persisted.
  await libsqlPing(db)
  await bootstrapCloudSchema(db)

  await storeSetCreds(db.databaseUrl, db.authToken)

  // Snapshot pushes (categories + KV). Small, always safe to send — they LWW
  // on the server so older values can't clobber newer ones.
  const local = await getUiSettings()
  const now = Date.now()
  try {
    if (local.categories.length > 0) await pushCategories(db, local.categories, now)
    await pushKv(db, KV_KEYS.uncategorizedAction, local.uncategorizedAction, now)
    await pushKv(db, KV_KEYS.summaryLanguage, local.summaryLanguage, now)
  } catch (err) {
    console.error('[cloud] connect: snapshot push failed:', err)
  }

  // Pull everything the cloud already has (events + snapshots) so this
  // device immediately sees another device's analysis.
  await pullAndApplyEvents(db, 0)
  await mergeCategoriesFromCloud(db)
  await mergeKvFromCloud(db)

  await setCloudLastSyncedAt(Date.now())

  const settings = await getUiSettings()
  return settings.cloud
}

/**
 * Opt-in: upload every locally-categorized message as an `overlay.set` event,
 * preserving each one's original `categorized_at` so other devices sort
 * history correctly. Triggered by the "Upload local history" button when the
 * user wants this device to act as the source of truth for past AI analysis.
 * Returns how many events were uploaded.
 */
export async function pushLocalHistory(): Promise<number> {
  const db = await getCloudCredentials()
  if (!db) return 0
  const snapshot = listCategorizedForBackfill()
  if (snapshot.length === 0) return 0
  try {
    for (let i = 0; i < snapshot.length; i += BACKFILL_CHUNK) {
      const chunk = snapshot.slice(i, i + BACKFILL_CHUNK).map((item) => ({
        type: 'overlay.set' as const,
        payload: {
          messageId: item.messageId,
          categoryId: item.categoryId,
          aiSummary: item.aiSummary,
          categorizedAt: item.categorizedAt
        },
        createdAt: item.categorizedAt
      }))
      await appendEventsBatch(db, chunk)
    }
    console.log(`[cloud] pushLocalHistory uploaded ${snapshot.length} overlay events`)
    return snapshot.length
  } catch (err) {
    console.error('[cloud] pushLocalHistory failed:', err)
    throw err
  }
}

/**
 * Drop local credentials. The cloud copy is untouched so a future reconnect
 * from the same account picks up where it left off.
 */
export async function disconnectCloud(): Promise<CloudConfig> {
  const settings = await storeDisconnect()
  return settings.cloud
}

/**
 * Incremental sync: pull events since the local cursor, apply, advance the
 * cursor. Also re-merges categories + KV snapshots so renames/reorders
 * propagate even though they don't ride the event log.
 */
export async function syncCloudNow(): Promise<CloudConfig> {
  const settings = await getUiSettings()
  if (!settings.cloud.enabled) return settings.cloud

  const db = await getCloudCredentials()
  if (!db) return settings.cloud

  try {
    await pullAndApplyEvents(db, settings.cloud.lastEventId)
    await mergeCategoriesFromCloud(db)
    await mergeKvFromCloud(db)
    await setCloudLastSyncedAt(Date.now())
  } catch (err) {
    console.error('[cloud] syncNow failed:', err)
  }

  const next = await getUiSettings()
  return next.cloud
}

// ---------------------------------------------------------------------------
// Event-log helpers
// ---------------------------------------------------------------------------

/**
 * Drain the remote log starting at `fromCursor`. Applies each event to
 * whichever local rows exist now; parks the rest in the local buffer so a
 * later IMAP sync can pick them up when the target message arrives.
 * Advances the persisted cursor to the max id consumed.
 */
async function pullAndApplyEvents(db: LibsqlCredentials, fromCursor: number): Promise<void> {
  let cursor = fromCursor
  // Loop so very long backlogs (e.g., a device coming online after months)
  // still drain fully — the server caps per-response size, so we iterate.
  for (;;) {
    let events: CloudEvent[]
    try {
      events = await pullEventsSince(db, cursor, PULL_CHUNK)
    } catch (err) {
      console.error('[cloud] pullEventsSince failed:', err)
      return
    }
    if (events.length === 0) break

    for (const event of events) {
      applyOverlayEvent(event)
    }
    const maxId = events[events.length - 1].id
    cursor = maxId
    await setCloudLastEventId(maxId)

    // Opportunistically drain the buffer in case earlier events found their
    // target message mid-loop.
    drainCloudOverlayBuffer()

    if (events.length < PULL_CHUNK) break
  }
}

function applyOverlayEvent(event: CloudEvent): void {
  const { payload } = event
  const refs = listRefsByMessageId(payload.messageId)
  if (refs.length === 0) {
    bufferCloudOverlay({
      messageId: payload.messageId,
      categoryId: payload.categoryId,
      aiSummary: payload.aiSummary,
      categorizedAt: payload.categorizedAt,
      eventId: event.id
    })
    return
  }
  for (const ref of refs) {
    setLocalCategory(ref.accountId, ref.uid, payload.categoryId)
    setAiSummary(ref.accountId, ref.uid, payload.aiSummary)
  }
}

// ---------------------------------------------------------------------------
// Write-side helpers (called from ai-auto + ipc)
// ---------------------------------------------------------------------------

/**
 * Emit an `overlay.set` event. Called after every local categorization.
 * No-op when the user isn't connected or the message has no Message-Id.
 * Fire-and-forget from the caller's perspective — errors are logged, not
 * thrown, so the AI loop never stalls on a flaky network.
 */
export async function pushMessageOverlay(
  messageId: string | null,
  payload: Omit<OverlaySetPayload, 'messageId'>
): Promise<void> {
  if (!messageId) return
  const db = await getCloudCredentials()
  if (!db) return
  try {
    await appendEvent(db, 'overlay.set', { messageId, ...payload }, Date.now())
  } catch (err) {
    console.error(`[cloud] appendEvent ${messageId} failed:`, err)
  }
}

export async function pushCategoriesIfConnected(categories: Category[]): Promise<void> {
  const db = await getCloudCredentials()
  if (!db) return
  try {
    await pushCategories(db, categories, Date.now())
  } catch (err) {
    console.error('[cloud] pushCategories failed:', err)
  }
}

export async function pushKvIfConnected<T>(key: string, value: T): Promise<void> {
  const db = await getCloudCredentials()
  if (!db) return
  try {
    await pushKv(db, key, value, Date.now())
  } catch (err) {
    console.error(`[cloud] pushKv ${key} failed:`, err)
  }
}

// ---------------------------------------------------------------------------
// Snapshot merges (categories + KV)
// ---------------------------------------------------------------------------

async function mergeCategoriesFromCloud(db: LibsqlCredentials): Promise<void> {
  let remote: CloudCategoryRow[]
  try {
    remote = await pullCategories(db)
  } catch (err) {
    console.error('[cloud] pullCategories failed:', err)
    return
  }
  if (remote.length === 0) return

  const local = await getUiSettings()
  const localById = new Map(local.categories.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const merged: Category[] = []

  // Respect cloud ordering so all devices converge to the same sort.
  for (const row of remote) {
    if (row.deletedAt) continue
    seen.add(row.category.id)
    // If both sides have this id, prefer the local one only when local
    // doesn't match remote exactly — remote wins on definition content,
    // local just contributes ordering if a newer edit is in flight.
    const localCat = localById.get(row.category.id)
    merged.push(localCat ?? row.category)
  }
  // Keep locally-only categories at the end; they'll get pushed up by the
  // caller's own writes later.
  for (const cat of local.categories) {
    if (!seen.has(cat.id)) merged.push(cat)
  }

  // Avoid a write (and a subsequent push back to cloud) when nothing changed.
  if (sameCategoryList(local.categories, merged)) return

  await storeSetCategories(merged, local.uncategorizedAction)
}

function sameCategoryList(a: Category[], b: Category[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false
    if (a[i].name !== b[i].name) return false
  }
  return true
}

async function mergeKvFromCloud(db: LibsqlCredentials): Promise<void> {
  const local = await getUiSettings()

  try {
    const remote = await pullKv<SummaryLanguage>(db, KV_KEYS.summaryLanguage)
    if (remote && remote.value !== local.summaryLanguage) {
      await storeSetSummaryLanguage(remote.value)
    }
  } catch (err) {
    console.error('[cloud] kv/summaryLanguage merge failed:', err)
  }

  try {
    const remote = await pullKv<CategoryAction>(db, KV_KEYS.uncategorizedAction)
    if (remote) {
      const fresh = await getUiSettings()
      await storeSetCategories(fresh.categories, remote.value)
    }
  } catch (err) {
    console.error('[cloud] kv/uncategorizedAction merge failed:', err)
  }
}
