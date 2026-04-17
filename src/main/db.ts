import { join } from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'

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
-- my wife, not "Mamá de Jerónimo" as some random sender once labeled her).
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
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized — call initDb() first.')
  return db
}
