import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { Account, AccountDraft, ImapProvider } from '../shared/settings'
import { deleteAllForAccount as deleteContactsForAccount } from './contacts-store'
import { resolveImapHost } from './imap-test'
import { deleteAllForAccount } from './messages-store'

type PersistedAccount = {
  id: string
  provider: ImapProvider
  email: string
  /** Optional user-defined display label. */
  label?: string | null
  host: string
  port: number
  /** App password, encrypted via safeStorage, base64-encoded. */
  encryptedPassword: string
  createdAt: string
}

type PersistedFile = {
  accounts: PersistedAccount[]
}

const DEFAULT_FILE: PersistedFile = { accounts: [] }

function accountsPath(): string {
  return join(app.getPath('userData'), 'accounts.json')
}

async function read(): Promise<PersistedFile> {
  try {
    const raw = await readFile(accountsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedFile>
    return { accounts: parsed.accounts ?? [] }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_FILE, accounts: [] }
    throw err
  }
}

async function write(file: PersistedFile): Promise<void> {
  // Strip any legacy/unknown fields when persisting (e.g. the old `folders` cache).
  const clean: PersistedFile = {
    accounts: file.accounts.map((a) => ({
      id: a.id,
      provider: a.provider,
      email: a.email,
      label: a.label ?? null,
      host: a.host,
      port: a.port,
      encryptedPassword: a.encryptedPassword,
      createdAt: a.createdAt
    }))
  }
  await writeFile(accountsPath(), JSON.stringify(clean, null, 2), 'utf8')
}

function toUi(account: PersistedAccount): Account {
  return {
    id: account.id,
    provider: account.provider,
    email: account.email,
    label: account.label ?? null,
    host: account.host,
    port: account.port,
    createdAt: account.createdAt
  }
}

export async function list(): Promise<Account[]> {
  const file = await read()
  return file.accounts.map(toUi)
}

export async function add(draft: AccountDraft): Promise<Account> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is not available; cannot store account password safely.')
  }
  const { host, port } = resolveImapHost(draft)
  const file = await read()

  const normalizedEmail = draft.email.trim().toLowerCase()
  if (file.accounts.some((a) => a.email.toLowerCase() === normalizedEmail)) {
    throw new Error(`An account for ${draft.email} already exists.`)
  }

  const persisted: PersistedAccount = {
    id: randomUUID(),
    provider: draft.provider,
    email: draft.email.trim(),
    label: null,
    host,
    port,
    encryptedPassword: safeStorage.encryptString(draft.password).toString('base64'),
    createdAt: new Date().toISOString()
  }
  await write({ accounts: [...file.accounts, persisted] })
  return toUi(persisted)
}

export async function remove(id: string): Promise<void> {
  const file = await read()
  await write({ accounts: file.accounts.filter((a) => a.id !== id) })
  try {
    deleteAllForAccount(id)
    deleteContactsForAccount(id)
  } catch (err) {
    // DB may not be initialized in tests / pre-init; safe to ignore.
    console.warn('[accounts] failed to clear cached messages on remove:', err)
  }
}

export async function setLabel(id: string, label: string | null): Promise<Account> {
  const file = await read()
  const account = file.accounts.find((a) => a.id === id)
  if (!account) throw new Error(`No account with id ${id}`)
  const trimmed = label?.trim() ?? ''
  account.label = trimmed.length > 0 ? trimmed : null
  await write(file)
  return toUi(account)
}

/**
 * Reorder accounts to match the given sequence of ids. Any ids missing from the
 * input are kept at the end in their previous order; unknown ids are ignored.
 */
export async function reorder(orderedIds: string[]): Promise<Account[]> {
  const file = await read()
  const byId = new Map(file.accounts.map((a) => [a.id, a]))
  const seen = new Set<string>()
  const reordered: PersistedAccount[] = []
  for (const id of orderedIds) {
    const account = byId.get(id)
    if (!account || seen.has(id)) continue
    reordered.push(account)
    seen.add(id)
  }
  for (const account of file.accounts) {
    if (!seen.has(account.id)) reordered.push(account)
  }
  await write({ accounts: reordered })
  return reordered.map(toUi)
}

export async function getPassword(id: string): Promise<string | null> {
  const file = await read()
  const account = file.accounts.find((a) => a.id === id)
  if (!account) return null
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is not available; cannot read stored password.')
  }
  return safeStorage.decryptString(Buffer.from(account.encryptedPassword, 'base64'))
}
