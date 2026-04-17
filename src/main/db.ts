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
