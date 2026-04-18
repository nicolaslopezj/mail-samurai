import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { type Account, ARCHIVE_RETENTION_MS, type EmailAddress } from '../shared/settings'
import { getPassword } from './accounts-store'
import { recordMessageAddresses } from './contacts-store'
import {
  deleteAllForAccount,
  getSyncState,
  listLocalUids,
  reconcileInbox,
  setSyncState,
  type UpsertInlineAttachment,
  type UpsertMessage,
  updateFlags,
  upsertMessages
} from './messages-store'

export type SyncResult = {
  accountId: string
  added: number
  updated: number
  /** Newly archived rows (messages removed from INBOX this pass). */
  archived: number
  /** Rows deleted (archived too long ago or older than `syncFromMs`). */
  deleted: number
}

function attachImapErrorHandler(client: ImapFlow, accountEmail: string): ImapFlow {
  client.on('error', (err) => {
    const code = (err as { code?: string } | null)?.code
    const method =
      code === 'EPIPE' || code === 'ECONNRESET' || code === 'ETIMEDOUT' ? 'warn' : 'error'
    console[method](`[imap] ${accountEmail} connection error${code ? ` (${code})` : ''}:`, err)
  })
  return client
}

function makeClient(account: Account, password: string): ImapFlow {
  return attachImapErrorHandler(
    new ImapFlow({
      host: account.host,
      port: account.port,
      secure: true,
      auth: { user: account.email, pass: password },
      logger: false,
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 60_000
    }),
    account.email
  )
}

function toAddress(
  input: { name?: string; address?: string } | undefined | null
): EmailAddress | null {
  if (!input?.address) return null
  return { name: input.name?.trim() || null, address: input.address }
}

function toAddressList(
  input: { value?: { name?: string; address?: string }[] } | undefined | null
): EmailAddress[] {
  const list = input?.value ?? []
  return list.map((v) => toAddress(v)).filter((v): v is EmailAddress => v !== null)
}

function makeSnippet(text: string | undefined | null): string | null {
  if (!text) return null
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (!collapsed) return null
  return collapsed.length > 200 ? `${collapsed.slice(0, 200)}…` : collapsed
}

type ParsedAttachment = {
  contentId?: string | null
  cid?: string | null
  contentType?: string | null
  content?: Buffer | Uint8Array | null
  contentDisposition?: string | null
}

/**
 * Keep only attachments referenced by a Content-ID — these are the ones the
 * HTML body can embed via `cid:`. Everything else is out of scope for inline
 * rendering and is ignored here.
 */
function extractInlineAttachments(parsed: {
  attachments?: ParsedAttachment[]
}): UpsertInlineAttachment[] {
  const list = parsed.attachments ?? []
  const out: UpsertInlineAttachment[] = []
  for (const a of list) {
    // mailparser surfaces Content-ID under both `contentId` (with angle
    // brackets) and `cid` (cleaned). Prefer `cid`, fall back to stripping.
    const rawId = a.cid ?? a.contentId
    if (!rawId) continue
    const contentId = rawId.replace(/^<|>$/g, '').trim()
    if (!contentId) continue
    if (!a.content) continue
    const bytes = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content)
    out.push({
      contentId,
      mime: (a.contentType || 'application/octet-stream').toLowerCase(),
      bytes
    })
  }
  return out
}

/**
 * Sync the INBOX of one account into the local cache.
 * - Adds messages newer than `syncFromMs` that aren't cached yet
 * - Updates flags for cached messages still in INBOX
 * - Marks missing-from-INBOX messages as archived; deletes them once their
 *   archive timestamp is older than `ARCHIVE_RETENTION_MS`
 * - Deletes messages older than `syncFromMs` (out of scope)
 * - Resets local cache if UIDVALIDITY changed
 */
export async function syncAccount(account: Account, syncFromMs: number): Promise<SyncResult> {
  const password = await getPassword(account.id)
  if (!password) throw new Error(`No stored password for account ${account.email}`)

  const client = makeClient(account, password)
  await client.connect()

  let added = 0
  let updated = 0
  let archivedCount = 0
  let deletedCount = 0

  try {
    const mailbox = await client.mailboxOpen('INBOX')
    const uidValidity = Number(mailbox.uidValidity)

    const state = getSyncState(account.id)
    if (state.uidValidity !== null && state.uidValidity !== uidValidity) {
      // UIDVALIDITY changed — wipe the cache for this account.
      deleteAllForAccount(account.id)
    }

    const since = new Date(syncFromMs)

    const serverUidsRaw = (await client.search({ since }, { uid: true })) || []
    const serverUids = serverUidsRaw.map((n) => Number(n))

    const localUids = new Set(listLocalUids(account.id, uidValidity))

    const newUids = serverUids.filter((uid) => !localUids.has(uid))
    const existingUids = serverUids.filter((uid) => localUids.has(uid))

    // --- Fetch full content for new messages -------------------------------
    if (newUids.length > 0) {
      const batch: UpsertMessage[] = []
      for await (const msg of client.fetch(
        newUids,
        { uid: true, envelope: true, flags: true, internalDate: true, source: true },
        { uid: true }
      )) {
        try {
          const source = msg.source as Buffer | undefined
          const flags = Array.from((msg.flags as Set<string> | undefined) ?? [])
          const internalDate = msg.internalDate as Date | undefined
          const envelope = msg.envelope as
            | {
                date?: Date
                subject?: string
                messageId?: string
                from?: { name?: string; address?: string }[]
                to?: { name?: string; address?: string }[]
                cc?: { name?: string; address?: string }[]
              }
            | undefined

          const parsed = source ? await simpleParser(source) : null

          const dateMs =
            internalDate?.getTime() ??
            envelope?.date?.getTime() ??
            parsed?.date?.getTime() ??
            Date.now()

          const fromAddress = toAddress(parsed?.from?.value?.[0]) ?? toAddress(envelope?.from?.[0])
          const toAddresses = parsed?.to
            ? toAddressList(parsed.to as never)
            : (envelope?.to ?? [])
                .map((a) => toAddress(a))
                .filter((a): a is EmailAddress => a !== null)
          const ccAddresses = parsed?.cc
            ? toAddressList(parsed.cc as never)
            : (envelope?.cc ?? [])
                .map((a) => toAddress(a))
                .filter((a): a is EmailAddress => a !== null)

          batch.push({
            accountId: account.id,
            uidValidity,
            uid: Number(msg.uid),
            messageId: parsed?.messageId ?? envelope?.messageId ?? null,
            subject: parsed?.subject ?? envelope?.subject ?? null,
            from: fromAddress,
            to: toAddresses,
            cc: ccAddresses,
            dateMs,
            flags,
            snippet: makeSnippet(parsed?.text ?? null),
            bodyText: parsed?.text ?? null,
            bodyHtml: typeof parsed?.html === 'string' ? parsed.html : null,
            inlineAttachments: parsed
              ? extractInlineAttachments(parsed as { attachments?: ParsedAttachment[] })
              : []
          })
        } catch (err) {
          console.error(`[sync] failed to parse uid=${msg.uid} for ${account.email}:`, err)
        }
      }
      upsertMessages(batch)
      added = batch.length
      // Fold the new messages into the contacts address book. INBOX fetches
      // always represent received mail from the account owner's perspective
      // — sent messages go to a separate folder we don't sync. If the user
      // happens to be the From (BCC-to-self), `recordMessageAddresses`
      // filters their own address back out.
      for (const m of batch) {
        recordMessageAddresses({
          accountId: account.id,
          ownEmail: account.email,
          from: m.from,
          to: m.to,
          cc: m.cc,
          dateMs: m.dateMs,
          fromOwner: m.from?.address.toLowerCase() === account.email.toLowerCase()
        })
      }
    }

    // --- Refresh flags for messages we already have ------------------------
    if (existingUids.length > 0) {
      const updates: { uid: number; flags: string[] }[] = []
      for await (const msg of client.fetch(
        existingUids,
        { uid: true, flags: true },
        { uid: true }
      )) {
        const flags = Array.from((msg.flags as Set<string> | undefined) ?? [])
        updates.push({ uid: Number(msg.uid), flags })
      }
      updateFlags(account.id, uidValidity, updates)
      updated = updates.length
    }

    // --- Reconcile archived / out-of-window rows --------------------------
    const reconciled = reconcileInbox({
      accountId: account.id,
      uidValidity,
      serverUids,
      syncFromMs,
      archiveRetentionMs: ARCHIVE_RETENTION_MS,
      now: Date.now()
    })
    archivedCount = reconciled.archived
    deletedCount = reconciled.deleted

    setSyncState(account.id, uidValidity, Date.now())
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore
    }
  }

  return {
    accountId: account.id,
    added,
    updated,
    archived: archivedCount,
    deleted: deletedCount
  }
}

/**
 * Toggle the `\Seen` flag for a single message on the IMAP server.
 * Fire-and-forget from the caller's perspective; the local cache is updated
 * optimistically elsewhere so the UI doesn't wait on the network.
 */
export async function setMessageSeen(account: Account, uid: number, seen: boolean): Promise<void> {
  const password = await getPassword(account.id)
  if (!password) throw new Error(`No stored password for account ${account.email}`)

  const client = makeClient(account, password)
  await client.connect()
  try {
    await client.mailboxOpen('INBOX')
    if (seen) {
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
    } else {
      await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true })
    }
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore
    }
  }
}

type MailboxListEntry = {
  path: string
  specialUse?: string
  flags?: Set<string> | string[]
}

/**
 * Pick the archive destination for an IMAP account. Prefer a folder tagged
 * with `\Archive` (RFC 6154). Fall back to Gmail's `\All` label and finally
 * to common folder names — then bail if nothing plausible exists.
 */
function pickArchiveMailbox(list: MailboxListEntry[]): string | null {
  const hasFlag = (m: MailboxListEntry, flag: string): boolean => {
    if (m.specialUse === flag) return true
    if (!m.flags) return false
    if (Array.isArray(m.flags)) return m.flags.includes(flag)
    return m.flags.has(flag)
  }
  const archive = list.find((m) => hasFlag(m, '\\Archive'))
  if (archive) return archive.path
  const all = list.find((m) => hasFlag(m, '\\All'))
  if (all) return all.path
  const byName = list.find((m) => ['Archive', 'Archives', '[Gmail]/All Mail'].includes(m.path))
  return byName?.path ?? null
}

/**
 * Move a message out of INBOX into the account's archive folder. The next
 * sync will pick up the absence from INBOX and stamp `archived_at_ms`;
 * callers should update the local cache optimistically for a snappy UI.
 */
export async function archiveMessage(account: Account, uid: number): Promise<void> {
  const password = await getPassword(account.id)
  if (!password) throw new Error(`No stored password for account ${account.email}`)

  const client = makeClient(account, password)
  await client.connect()
  try {
    const mailboxes = (await client.list()) as MailboxListEntry[]
    const destination = pickArchiveMailbox(mailboxes)
    if (!destination) {
      throw new Error(`No archive folder found for ${account.email}`)
    }
    await client.mailboxOpen('INBOX')
    await client.messageMove(String(uid), destination, { uid: true })
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore
    }
  }
}

/**
 * Pick the trash destination for an IMAP account. Prefer `\Trash` (RFC 6154),
 * then fall back to common folder names. Returns null if nothing plausible is
 * available — caller should surface an error rather than silently swallowing.
 */
function pickTrashMailbox(list: MailboxListEntry[]): string | null {
  const hasFlag = (m: MailboxListEntry, flag: string): boolean => {
    if (m.specialUse === flag) return true
    if (!m.flags) return false
    if (Array.isArray(m.flags)) return m.flags.includes(flag)
    return m.flags.has(flag)
  }
  const trash = list.find((m) => hasFlag(m, '\\Trash'))
  if (trash) return trash.path
  const byName = list.find((m) =>
    ['Trash', 'Deleted Messages', 'Deleted Items', '[Gmail]/Trash'].includes(m.path)
  )
  return byName?.path ?? null
}

/**
 * Move a message from INBOX into the account's Trash folder. Mirrors
 * `archiveMessage` but targets `\Trash`. The next sync stamps
 * `archived_at_ms` locally as usual; callers may also drop the local row.
 */
export async function deleteMessageImap(account: Account, uid: number): Promise<void> {
  const password = await getPassword(account.id)
  if (!password) throw new Error(`No stored password for account ${account.email}`)

  const client = makeClient(account, password)
  await client.connect()
  try {
    const mailboxes = (await client.list()) as MailboxListEntry[]
    const destination = pickTrashMailbox(mailboxes)
    if (!destination) {
      throw new Error(`No Trash folder found for ${account.email}`)
    }
    await client.mailboxOpen('INBOX')
    await client.messageMove(String(uid), destination, { uid: true })
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore
    }
  }
}

/**
 * Move a message from INBOX into a user-specified folder. Creates the folder
 * on the fly if it doesn't exist — users type names freehand in Settings and
 * expect the action to "just work" without pre-creating the mailbox.
 */
export async function moveMessageToFolder(
  account: Account,
  uid: number,
  folder: string
): Promise<void> {
  const password = await getPassword(account.id)
  if (!password) throw new Error(`No stored password for account ${account.email}`)

  const client = makeClient(account, password)
  await client.connect()
  try {
    // mailboxCreate throws if the folder already exists; that's fine — we
    // only care that the destination is there before the move.
    try {
      await client.mailboxCreate(folder)
    } catch {
      // assume it already exists
    }
    await client.mailboxOpen('INBOX')
    await client.messageMove(String(uid), folder, { uid: true })
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore
    }
  }
}

/**
 * Move an archived message back to INBOX. The local row's UID is no longer
 * valid (it was the INBOX UID before the archive), so the caller should
 * delete the local row after this resolves and let the next sync refetch
 * the message under its fresh INBOX UID.
 *
 * `messageId` is the RFC 5322 header — we locate the message in the archive
 * folder by searching that header, since UIDs differ per folder.
 */
export async function unarchiveMessage(account: Account, messageId: string): Promise<void> {
  const password = await getPassword(account.id)
  if (!password) throw new Error(`No stored password for account ${account.email}`)

  // IMAP header search is typically a substring match, but servers differ
  // on whether angle brackets are tolerated — strip them to be safe.
  const bareId = messageId.replace(/[<>]/g, '').trim()
  if (!bareId) throw new Error('Empty Message-Id; cannot locate in archive.')

  const client = makeClient(account, password)
  await client.connect()
  try {
    const mailboxes = (await client.list()) as MailboxListEntry[]
    const hasFlag = (m: MailboxListEntry, flag: string): boolean => {
      if (m.specialUse === flag) return true
      if (!m.flags) return false
      if (Array.isArray(m.flags)) return m.flags.includes(flag)
      return m.flags.has(flag)
    }
    // Try the detected archive folder first, then fall back to any other
    // non-system folder. iCloud and some hosts occasionally route moves to
    // folders that don't carry the `\Archive` flag, so search broadly
    // rather than giving up on the first miss.
    const primary = pickArchiveMailbox(mailboxes)
    const skipFlags = ['\\Inbox', '\\Sent', '\\Drafts', '\\Trash', '\\Junk']
    const candidates = [
      ...(primary ? [primary] : []),
      ...mailboxes
        .filter((m) => m.path !== primary && m.path !== 'INBOX')
        .filter((m) => !skipFlags.some((f) => hasFlag(m, f)))
        .map((m) => m.path)
    ]
    // For each candidate folder, try an IMAP HEADER search first; if that
    // returns empty, scan the last ~100 envelopes and match Message-Id
    // ourselves. iCloud's IMAP often returns no HEADER hits even when the
    // message is present, so the fallback is load-bearing.
    for (const folder of candidates) {
      try {
        await client.mailboxOpen(folder)
      } catch {
        continue
      }
      let archiveUid: number | null = null
      const hits = await client.search({ header: { 'message-id': bareId } }, { uid: true })
      if (hits && hits.length > 0) {
        archiveUid = hits[hits.length - 1]
      } else {
        const exists = (client.mailbox && (client.mailbox as { exists?: number }).exists) || 0
        if (exists > 0) {
          const start = Math.max(1, exists - 100)
          for await (const msg of client.fetch(`${start}:${exists}`, {
            uid: true,
            envelope: true
          })) {
            const envId = msg.envelope?.messageId
            if (!envId) continue
            if (envId.replace(/[<>]/g, '').trim() === bareId) {
              archiveUid = msg.uid
              break
            }
          }
        }
      }
      if (archiveUid !== null) {
        await client.messageMove(String(archiveUid), 'INBOX', { uid: true })
        return
      }
    }
    throw new Error(`Message not found in any archive folder for ${account.email}.`)
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore
    }
  }
}
