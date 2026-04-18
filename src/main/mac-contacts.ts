import { app } from 'electron'
import type { MacContactsStatus } from '../shared/settings'
import { getDb } from './db'

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
  requestAccess: () => Promise<string>
  getAuthStatus: () => string
  getAllContacts: () => Promise<MacContact[]>
}

let nativeCache: NativeModule | null | undefined

function runtimeContext(): string {
  return `bundleId=${app.getBundleID() || 'unknown'} packaged=${app.isPackaged} platform=${process.platform} arch=${process.arch}`
}

function getNative(): NativeModule | null {
  if (nativeCache !== undefined) return nativeCache
  if (process.platform !== 'darwin') {
    console.log('[mac-contacts] native module unavailable on non-macOS runtime')
    nativeCache = null
    return null
  }
  try {
    // Native direct bridge to CNContactStore. We keep this in-process so the
    // permission lands under Privacy & Security -> Contacts for Mail Samurai.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeCache = require('@mail-samurai/mac-contacts-native') as NativeModule
    console.log(`[mac-contacts] loaded native module (${runtimeContext()})`)
  } catch (err) {
    console.error('[mac-contacts] failed to load native module:', err)
    nativeCache = null
  }
  return nativeCache
}

export function isSupported(): boolean {
  return getNative() !== null
}

export function getAuthStatus(): MacContactsStatus {
  const n = getNative()
  if (!n) return 'unsupported'
  const raw = n.getAuthStatus()
  console.log(`[mac-contacts] native auth status: ${raw}`)
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

export async function requestAccess(): Promise<MacContactsStatus> {
  const n = getNative()
  if (!n) return 'unsupported'
  try {
    console.log(`[mac-contacts] requestAccess start (${runtimeContext()})`)
    console.log(`[mac-contacts] requestAccess preflight status: ${n.getAuthStatus()}`)
    const raw = await n.requestAccess()
    console.log(`[mac-contacts] native requestAccess result: ${raw}`)
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
  contactsRead: number
  addressesStored: number
}

export async function importAll(): Promise<MacImportResult> {
  const n = getNative()
  if (!n) throw new Error('macOS Contacts are not available on this platform.')
  const status = getAuthStatus()
  console.log(`[mac-contacts] importAll requested with status=${status}`)
  if (status !== 'authorized') {
    throw new Error(
      status === 'denied'
        ? 'Contacts access was denied. Grant access in System Settings → Privacy & Security → Contacts.'
        : `Contacts access not granted (${status}).`
    )
  }

  const contacts = await n.getAllContacts()
  console.log(`[mac-contacts] native getAllContacts returned ${contacts.length} contacts`)
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
         source_id = excluded.source_id,
         imported_at_ms = excluded.imported_at_ms`
    )
    for (const r of rows) stmt.run(r.address, r.name, r.sourceId, now)
  })
  tx()

  const storedRow = db.prepare(`SELECT COUNT(*) AS n FROM mac_contacts`).get() as { n: number }
  console.log(
    `[mac-contacts] import complete contactsRead=${contacts.filter((c) => (c.emailAddresses ?? []).length > 0).length} addressesStored=${storedRow.n}`
  )
  return {
    contactsRead: contacts.filter((c) => (c.emailAddresses ?? []).length > 0).length,
    addressesStored: storedRow.n
  }
}

export function clearAll(): void {
  const db = getDb()
  db.prepare(`DELETE FROM mac_contacts`).run()
  console.log('[mac-contacts] cleared imported contacts')
}

export function countStored(): number {
  const db = getDb()
  const row = db.prepare(`SELECT COUNT(*) AS n FROM mac_contacts`).get() as { n: number }
  return row.n
}

export function lastImportedAt(): number | null {
  const db = getDb()
  const row = db.prepare(`SELECT MAX(imported_at_ms) AS t FROM mac_contacts`).get() as {
    t: number | null
  }
  return row.t
}
