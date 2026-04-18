import { ImapFlow } from 'imapflow'
import { type AccountDraft, IMAP_PRESETS } from '../shared/settings'

function attachImapErrorHandler(client: ImapFlow, accountEmail: string): ImapFlow {
  client.on('error', (err) => {
    const code = (err as { code?: string } | null)?.code
    const method =
      code === 'EPIPE' || code === 'ECONNRESET' || code === 'ETIMEDOUT' ? 'warn' : 'error'
    console[method](`[imap:test] ${accountEmail} connection error${code ? ` (${code})` : ''}:`, err)
  })
  return client
}

/** Resolve hostname/port from provider preset, or from the draft's custom values. */
export function resolveImapHost(draft: AccountDraft): { host: string; port: number } {
  if (draft.provider === 'custom') {
    if (!draft.host) throw new Error('Host is required for a custom IMAP account.')
    return { host: draft.host, port: draft.port ?? 993 }
  }
  return IMAP_PRESETS[draft.provider]
}

/**
 * Attempts an IMAP login with the given credentials. Resolves on success.
 * Throws a readable Error on failure (wrong password, bad host, timeout, etc).
 */
export async function testImapAuth(draft: AccountDraft): Promise<void> {
  const { host, port } = resolveImapHost(draft)
  const client = attachImapErrorHandler(
    new ImapFlow({
      host,
      port,
      secure: true,
      auth: { user: draft.email, pass: draft.password },
      logger: false,
      // Keep the test snappy — fail fast on bad creds / unreachable host.
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000
    }),
    draft.email
  )

  try {
    await client.connect()
  } catch (err) {
    throw new Error(normalizeImapError(err, draft))
  }

  try {
    await client.logout()
  } catch {
    // Logout failures don't invalidate a successful auth.
  }
}

function normalizeImapError(err: unknown, draft: AccountDraft): string {
  const message = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string; authenticationFailed?: boolean } | null)?.code

  if ((err as { authenticationFailed?: boolean } | null)?.authenticationFailed) {
    if (draft.provider === 'gmail') {
      return 'Gmail rejected the credentials. Make sure you used an app password (not your Google password) and that 2-Step Verification is enabled.'
    }
    if (draft.provider === 'icloud') {
      return 'iCloud rejected the credentials. Make sure you used an app-specific password and that two-factor authentication is enabled.'
    }
    return `Authentication failed: ${message}`
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Could not resolve host: ${message}`
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED')
    return `Could not reach IMAP server: ${message}`
  return message
}
