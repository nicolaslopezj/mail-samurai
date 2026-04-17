import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { Account, EmailAddress } from '../shared/settings'
import { getPassword } from './accounts-store'
import {
  deleteAllForAccount,
  deleteMissing,
  getSyncState,
  listLocalUids,
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
  pruned: number
}

function makeClient(account: Account, password: string): ImapFlow {
  return new ImapFlow({
    host: account.host,
    port: account.port,
    secure: true,
    auth: { user: account.email, pass: password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000
  })
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
 * - Adds messages newer than `cutoff` that aren't cached yet
 * - Updates flags for cached messages still in scope
 * - Deletes cached messages that fell out of scope (deleted upstream OR older than cutoff)
 * - Resets local cache if UIDVALIDITY changed
 */
export async function syncAccount(account: Account, retentionHours: number): Promise<SyncResult> {
  const password = await getPassword(account.id)
  if (!password) throw new Error(`No stored password for account ${account.email}`)

  const client = makeClient(account, password)
  await client.connect()

  let added = 0
  let updated = 0
  let pruned = 0

  try {
    const mailbox = await client.mailboxOpen('INBOX')
    const uidValidity = Number(mailbox.uidValidity)

    const state = getSyncState(account.id)
    if (state.uidValidity !== null && state.uidValidity !== uidValidity) {
      // UIDVALIDITY changed — wipe the cache for this account.
      deleteAllForAccount(account.id)
    }

    const cutoff = Date.now() - retentionHours * 3_600_000
    const since = new Date(cutoff)

    const serverUidsRaw = (await client.search({ since }, { uid: true })) || []
    const serverUids = serverUidsRaw.map((n) => Number(n))
    const serverUidSet = new Set(serverUids)

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

    // --- Prune stale rows -------------------------------------------------
    pruned = deleteMissing(account.id, uidValidity, [...serverUidSet], cutoff)

    setSyncState(account.id, uidValidity, Date.now())
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore
    }
  }

  return { accountId: account.id, added, updated, pruned }
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
