import { join } from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { PENDING_ARCHIVE_STALE_MS } from '../shared/settings'

let db: Database.Database | null = null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  account_id    TEXT NOT NULL,
  uid_validity  INTEGER NOT NULL,
  uid           INTEGER NOT NULL,
  message_id    TEXT,
  subject       TEXT,
  from_name     TEXT,
  from_address  TEXT,
  to_json       TEXT NOT NULL DEFAULT '[]',
  cc_json       TEXT NOT NULL DEFAULT '[]',
  date_ms       INTEGER NOT NULL,
  flags_json    TEXT NOT NULL DEFAULT '[]',
  seen          INTEGER NOT NULL DEFAULT 0,
  flagged       INTEGER NOT NULL DEFAULT 0,
  snippet       TEXT,
  body_text     TEXT,
  body_html     TEXT,
  fetched_at_ms INTEGER NOT NULL,
  archived_at_ms INTEGER,
  PRIMARY KEY (account_id, uid_validity, uid)
);

CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date_ms DESC);
CREATE INDEX IF NOT EXISTS idx_messages_account_date ON messages(account_id, date_ms DESC);

CREATE TABLE IF NOT EXISTS account_sync_state (
  account_id    TEXT PRIMARY KEY,
  uid_validity  INTEGER,
  last_sync_ms  INTEGER
);

CREATE TABLE IF NOT EXISTS inline_attachments (
  account_id   TEXT NOT NULL,
  uid_validity INTEGER NOT NULL,
  uid          INTEGER NOT NULL,
  content_id   TEXT NOT NULL,
  mime         TEXT NOT NULL,
  bytes        BLOB NOT NULL,
  PRIMARY KEY (account_id, uid_validity, uid, content_id)
);

CREATE INDEX IF NOT EXISTS idx_inline_attachments_msg
  ON inline_attachments(account_id, uid_validity, uid);

-- Per-account derived address book. Populated from every message we sync
-- (from/to/cc) and every SMTP draft we send. One row per (account, address)
-- pair so the same contact seen from two of our accounts keeps independent
-- counters. Addresses are stored lowercased; display_name holds the most
-- recent non-empty name we've seen.
CREATE TABLE IF NOT EXISTS contacts (
  account_id     TEXT    NOT NULL,
  address        TEXT    NOT NULL,
  display_name   TEXT,
  first_seen_ms  INTEGER NOT NULL,
  last_seen_ms   INTEGER NOT NULL,
  sent_count     INTEGER NOT NULL DEFAULT 0,
  received_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, address)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_contacts_recent
  ON contacts(account_id, last_seen_ms DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_address
  ON contacts(address);

-- User's macOS Contacts app, imported on demand via CNContactStore. Takes
-- priority over \`contacts.display_name\` for the same address — the user's
-- own address book is the source of truth for names (e.g., "my wife" stays
-- my wife, not "Mamá de XX" as some random sender once labeled her).
-- One row per address; a single Mac contact with N emails becomes N rows.
CREATE TABLE IF NOT EXISTS mac_contacts (
  address        TEXT    NOT NULL PRIMARY KEY,
  display_name   TEXT    NOT NULL,
  /** Apple identifier for the source CNContact; lets us update in-place. */
  source_id      TEXT,
  imported_at_ms INTEGER NOT NULL
) WITHOUT ROWID;

-- Buffer for cloud events whose target message isn't cached locally yet.
-- Populated during cloud sync; drained whenever IMAP upserts a message whose
-- message_id matches a buffered event. Events are idempotent, so re-applying
-- is harmless; the buffer just avoids the "AI re-runs on a message the cloud
-- already categorized" case when a new device is still backfilling IMAP.
CREATE TABLE IF NOT EXISTS cloud_event_buffer (
  message_id     TEXT    NOT NULL PRIMARY KEY,
  category_id    TEXT,
  ai_summary     TEXT,
  categorized_at INTEGER NOT NULL,
  /** Event id so older buffered payloads lose to newer ones on upsert. */
  event_id       INTEGER NOT NULL
) WITHOUT ROWID;

-- Pending user-initiated archive / unarchive batches. The message list and
-- sidebar counts render as if each pending row had already been applied; the
-- actual IMAP round-trip fires after the defer window (5s) unless the user
-- undoes the batch. One batch can hold many messages (e.g. "Archive all"),
-- all committed or cancelled as a unit.
CREATE TABLE IF NOT EXISTS pending_action_batches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mode         TEXT    NOT NULL CHECK(mode IN ('archive','unarchive')),
  scheduled_at INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_actions (
  batch_id   INTEGER NOT NULL REFERENCES pending_action_batches(id) ON DELETE CASCADE,
  account_id TEXT    NOT NULL,
  uid        INTEGER NOT NULL,
  PRIMARY KEY (account_id, uid)
);

CREATE INDEX IF NOT EXISTS idx_pending_actions_batch
  ON pending_actions(batch_id);
`

export function initDb(): Database.Database {
  if (db) return db
  const file = join(app.getPath('userData'), 'cache.sqlite')
  const instance = new Database(file)
  instance.pragma('journal_mode = WAL')
  instance.pragma('synchronous = NORMAL')
  instance.exec(SCHEMA)
  migrate(instance)
  db = instance
  return instance
}

/**
 * Lightweight forward-only migrations — additive columns we added after the
 * initial schema. `CREATE TABLE IF NOT EXISTS` takes care of brand-new DBs;
 * this handles existing user DBs that were built with an older shape.
 */
function migrate(instance: Database.Database): void {
  const cols = instance.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[]
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('category_id')) {
    instance.exec(`ALTER TABLE messages ADD COLUMN category_id TEXT`)
  }
  if (!names.has('ai_summary')) {
    instance.exec(`ALTER TABLE messages ADD COLUMN ai_summary TEXT`)
  }
  if (!names.has('categorized_at')) {
    instance.exec(`ALTER TABLE messages ADD COLUMN categorized_at INTEGER`)
  }
  if (!names.has('archived_at_ms')) {
    instance.exec(`ALTER TABLE messages ADD COLUMN archived_at_ms INTEGER`)
  }
  instance.exec(`CREATE INDEX IF NOT EXISTS idx_messages_category ON messages(category_id)`)
  instance.exec(`CREATE INDEX IF NOT EXISTS idx_messages_archived ON messages(archived_at_ms)`)

  // Drop any stale view (its definition is tied to the pending tables), then
  // recreate so schema tweaks here are picked up without a manual wipe.
  instance.exec(`DROP VIEW IF EXISTS messages_effective`)
  instance.exec(`
    CREATE VIEW messages_effective AS
    SELECT m.*,
      CASE
        WHEN pab.mode = 'archive' THEN 1
        WHEN pab.mode = 'unarchive' THEN 0
        WHEN m.archived_at_ms IS NOT NULL THEN 1
        ELSE 0
      END AS effective_archived,
      pab.mode AS pending_mode,
      pab.id   AS pending_batch_id
    FROM messages m
    LEFT JOIN pending_actions pa
      ON pa.account_id = m.account_id AND pa.uid = m.uid
    LEFT JOIN pending_action_batches pab
      ON pab.id = pa.batch_id
     AND pab.created_at >= CAST(strftime('%s', 'now') AS INTEGER) * 1000 - ${PENDING_ARCHIVE_STALE_MS}
  `)
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized — call initDb() first.')
  return db
}
