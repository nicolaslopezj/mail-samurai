import type { MacContactsStatus } from '../shared/settings'
import { getDb } from './db'

// -----------------------------------------------------------------------------
// Lazy native-module load
// -----------------------------------------------------------------------------
//
// `electron-mac-contacts` is a macOS-only native addon. Importing it on Linux
// or Windows would throw on require — so we defer the require() call and
// guard every caller with a platform check.

type MacContact = {
  identifier: string
  firstName?: string
  middleName?: string
  lastName?: string
  nickname?: string
  name?: string
  organizationName?: string
  emailAddresses?: string[]
}

type NativeModule = {
  requestAccess: () => Promise<boolean>
  getAuthStatus: () => string
  getAllContacts: () => Promise<MacContact[]>
}

let nativeCache: NativeModule | null | undefined
function getNative(): NativeModule | null {
  if (nativeCache !== undefined) return nativeCache
  if (process.platform !== 'darwin') {
    nativeCache = null
    return null
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeCache = require('electron-mac-contacts') as NativeModule
  } catch (err) {
    console.error('[mac-contacts] failed to load native module:', err)
    nativeCache = null
  }
  return nativeCache
}

export function isSupported(): boolean {
  return getNative() !== null
}

/**
 * Return one of: `unsupported` (non-macOS), `notDetermined` (never asked —
 * calling `requestAccess` will show the prompt), `authorized`, `denied`,
 * `restricted` (parental controls, MDM).
 */
export function getAuthStatus(): MacContactsStatus {
  const n = getNative()
  if (!n) return 'unsupported'
  const raw = n.getAuthStatus()
  switch (raw) {
    case 'Authorized':
      return 'authorized'
    case 'Denied':
      return 'denied'
    case 'Restricted':
      return 'restricted'
    case 'Not Determined':
      return 'notDetermined'
    default:
      return 'notDetermined'
  }
}

/**
 * Ask macOS for permission. First call shows the system prompt; subsequent
 * calls return the stored decision silently. If the user previously denied,
 * they must re-grant in System Settings → Privacy & Security → Contacts —
 * there's no way to re-prompt them from code.
 */
export async function requestAccess(): Promise<MacContactsStatus> {
  const n = getNative()
  if (!n) return 'unsupported'
  try {
    await n.requestAccess()
  } catch (err) {
    console.error('[mac-contacts] requestAccess threw:', err)
  }
  return getAuthStatus()
}

function deriveName(c: MacContact): string | null {
  if (c.name?.trim()) return c.name.trim()
  const parts = [c.firstName, c.middleName, c.lastName].filter((p): p is string => !!p?.trim())
  if (parts.length > 0) return parts.join(' ').trim()
  if (c.nickname?.trim()) return c.nickname.trim()
  if (c.organizationName?.trim()) return c.organizationName.trim()
  return null
}

export type MacImportResult = {
  /** Number of (email-bearing) contacts read from the Mac. */
  contactsRead: number
  /** Number of (address, name) rows ultimately in the table after import. */
  addressesStored: number
}

/**
 * Full refresh: read every email-bearing contact from the Mac and rewrite
 * the `mac_contacts` table. A fresh snapshot is simpler (and cheap — the
 * user's address book is in the low thousands at most) than trying to
 * incrementally reconcile; matches what the Mail.app "Previous Recipients"
 * UX does when you toggle the source.
 */
export async function importAll(): Promise<MacImportResult> {
  const n = getNative()
  if (!n) throw new Error('macOS Contacts are not available on this platform.')
  const status = getAuthStatus()
  if (status !== 'authorized') {
    throw new Error(
      status === 'denied'
        ? 'Contacts access was denied. Grant access in System Settings → Privacy & Security → Contacts.'
        : `Contacts access not granted (${status}).`
    )
  }

  const contacts = await n.getAllContacts()
  const now = Date.now()
  const rows: { address: string; name: string; sourceId: string }[] = []
  for (const c of contacts) {
    const emails = c.emailAddresses ?? []
    if (emails.length === 0) continue
    const name = deriveName(c)
    if (!name) continue
    for (const raw of emails) {
      const address = raw.trim().toLowerCase()
      if (!address.includes('@')) continue
      rows.push({ address, name, sourceId: c.identifier })
    }
  }

  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM mac_contacts`).run()
    const stmt = db.prepare(
      `INSERT INTO mac_contacts (address, display_name, source_id, imported_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
         display_name = excluded.display_name,
         source_id    = excluded.source_id,
         imported_at_ms = excluded.imported_at_ms`
    )
    for (const r of rows) stmt.run(r.address, r.name, r.sourceId, now)
  })
  tx()

  const storedRow = db.prepare(`SELECT COUNT(*) AS n FROM mac_contacts`).get() as { n: number }
  return {
    contactsRead: contacts.filter((c) => (c.emailAddresses ?? []).length > 0).length,
    addressesStored: storedRow.n
  }
}

/** Wipe every Mac contact — used when the user disconnects the source. */
export function clearAll(): void {
  const db = getDb()
  db.prepare(`DELETE FROM mac_contacts`).run()
}

export function countStored(): number {
  const db = getDb()
  const row = db.prepare(`SELECT COUNT(*) AS n FROM mac_contacts`).get() as { n: number }
  return row.n
}

/** Epoch ms of the most recent import, or null if the table is empty. */
export function lastImportedAt(): number | null {
  const db = getDb()
  const row = db.prepare(`SELECT MAX(imported_at_ms) AS t FROM mac_contacts`).get() as {
    t: number | null
  }
  return row.t
}
