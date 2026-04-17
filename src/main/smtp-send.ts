import { createTransport } from 'nodemailer'
import type { Account, EmailAddress, EmailDraft } from '../shared/settings'
import { SMTP_PRESETS } from '../shared/settings'
import { getPassword } from './accounts-store'
import { recordMessageAddresses } from './contacts-store'

function resolveSmtp(account: Account): { host: string; port: number; secure: boolean } {
  if (account.provider !== 'custom') return SMTP_PRESETS[account.provider]
  // Best-effort default for custom IMAP accounts: swap `imap` → `smtp` and
  // use submission-over-TLS on 465. Works for most providers; users with
  // exotic setups will need a dedicated SMTP config (not yet exposed).
  const host = account.host.replace(/^imap\./i, 'smtp.')
  return { host, port: 465, secure: true }
}

function formatAddress(addr: EmailAddress): string {
  return addr.name ? `"${addr.name.replace(/"/g, '\\"')}" <${addr.address}>` : addr.address
}

export async function sendDraft(account: Account, draft: EmailDraft): Promise<void> {
  const password = await getPassword(account.id)
  if (!password) throw new Error(`No stored password for ${account.email}.`)

  const { host, port, secure } = resolveSmtp(account)
  const transporter = createTransport({
    host,
    port,
    secure,
    auth: { user: account.email, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000
  })

  const headers: Record<string, string> = {}
  if (draft.inReplyToMessageId) {
    const parent = `<${draft.inReplyToMessageId}>`
    headers['In-Reply-To'] = parent
    headers.References = parent
  }

  await transporter.sendMail({
    from: formatAddress({ name: null, address: account.email }),
    to: draft.to.map(formatAddress),
    cc: draft.cc.length > 0 ? draft.cc.map(formatAddress) : undefined,
    subject: draft.subject,
    text: draft.bodyText,
    html: draft.bodyHtml ?? undefined,
    headers
  })

  transporter.close()

  // Credit every recipient with a "sent" sighting so the autocomplete ranks
  // people you actually email above passive received-only contacts.
  recordMessageAddresses({
    accountId: account.id,
    ownEmail: account.email,
    from: { name: null, address: account.email },
    to: draft.to,
    cc: draft.cc,
    dateMs: Date.now(),
    fromOwner: true
  })
}
