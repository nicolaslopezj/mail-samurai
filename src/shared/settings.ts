export type AiProvider = 'openai' | 'google'

export const AI_PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google Gemini' }
]

export type AiModel = {
  id: string
  label: string
}

export const RETENTION_DEFAULT_HOURS = 24
export const RETENTION_MIN_HOURS = 1
export const RETENTION_MAX_HOURS = 24 * 365

export const POLL_DEFAULT_MINUTES = 15
export const POLL_MIN_MINUTES = 1
export const POLL_MAX_MINUTES = 1440

export const LOAD_REMOTE_IMAGES_DEFAULT = true

/**
 * What should happen to a message that lands in a category. Discriminated by
 * `kind`; some kinds carry an extra user-provided parameter (folder / command).
 */
export type CategoryAction =
  | { kind: 'none' }
  | { kind: 'markRead' }
  | { kind: 'todo' }
  | { kind: 'archive' }
  | { kind: 'delete' }
  | { kind: 'moveToFolder'; folder: string }
  | { kind: 'runCommand'; command: string }

export type CategoryActionKind = CategoryAction['kind']

export const CATEGORY_ACTIONS: { value: CategoryActionKind; label: string; hint: string }[] = [
  { value: 'none', label: 'Do nothing', hint: 'Leave the message untouched in the inbox.' },
  { value: 'markRead', label: 'Mark as read', hint: 'Clear the unread flag.' },
  {
    value: 'todo',
    label: 'Add to To-Do',
    hint: 'Flag it for an internal list of messages that need attention.'
  },
  { value: 'archive', label: 'Archive', hint: 'Move the message out of the inbox.' },
  { value: 'delete', label: 'Delete', hint: 'Move the message to Trash.' },
  { value: 'moveToFolder', label: 'Move to folder…', hint: 'Move into an IMAP folder you name.' },
  {
    value: 'runCommand',
    label: 'Run a command…',
    hint: 'Run a shell command on your machine. The message is also left as-is.'
  }
]

/**
 * A user-defined bucket for incoming mail. The AI decides whether a message
 * belongs in this category by reading `instructions` as a natural-language
 * rule (e.g. "receipts from online purchases", "newsletters I signed up for").
 */
export type Category = {
  id: string
  name: string
  instructions: string
  action: CategoryAction
}

export type UiSettings = {
  aiProvider: AiProvider | null
  aiModel: string | null
  hasKey: Record<AiProvider, boolean>
  /** How many hours of inbox history to keep cached locally. */
  retentionHours: number
  /** How often the background sync runs, in minutes. */
  pollIntervalMinutes: number
  /**
   * Whether the email reader should fetch remote (http/https) images.
   * Off by default in privacy-focused clients to avoid tracking pixels —
   * we default to ON for usability but expose a setting to turn it off.
   */
  loadRemoteImages: boolean
  categories: Category[]
}

export type SettingsApi = {
  get: () => Promise<UiSettings>
  setProvider: (provider: AiProvider, model: string | null) => Promise<UiSettings>
  setApiKey: (provider: AiProvider, apiKey: string) => Promise<UiSettings>
  listModels: (provider: AiProvider, apiKey?: string) => Promise<AiModel[]>
  setRetentionHours: (hours: number) => Promise<UiSettings>
  setPollIntervalMinutes: (minutes: number) => Promise<UiSettings>
  setLoadRemoteImages: (enabled: boolean) => Promise<UiSettings>
  setCategories: (categories: Category[]) => Promise<UiSettings>
}

// ---------------------------------------------------------------------------
// Email accounts
// ---------------------------------------------------------------------------

export type ImapProvider = 'gmail' | 'icloud' | 'custom'

export const IMAP_PROVIDERS: {
  value: ImapProvider
  label: string
  helpUrl?: string
  helpText?: string
}[] = [
  {
    value: 'gmail',
    label: 'Gmail',
    helpUrl: 'https://myaccount.google.com/apppasswords',
    helpText: 'Requires 2-Step Verification. Generate an app password and paste it here.'
  },
  {
    value: 'icloud',
    label: 'iCloud',
    helpUrl: 'https://appleid.apple.com',
    helpText: 'Requires two-factor auth. Sign in → Sign-In and Security → App-Specific Passwords.'
  },
  { value: 'custom', label: 'Other IMAP' }
]

export const IMAP_PRESETS: Record<
  Exclude<ImapProvider, 'custom'>,
  { host: string; port: number }
> = {
  gmail: { host: 'imap.gmail.com', port: 993 },
  icloud: { host: 'imap.mail.me.com', port: 993 }
}

/** Form payload used to test + create an account. */
export type AccountDraft = {
  provider: ImapProvider
  email: string
  password: string
  host?: string
  port?: number
}

/** What the renderer sees — never includes the password. */
export type Account = {
  id: string
  provider: ImapProvider
  email: string
  /** User-defined display label. Falls back to email when null. */
  label: string | null
  host: string
  port: number
  createdAt: string
}

/** Friendly display name for an account — label if set, otherwise email. */
export function accountDisplayName(account: Account): string {
  return account.label?.trim() || account.email
}

export type AccountsApi = {
  list: () => Promise<Account[]>
  /** Attempts an IMAP login; resolves on success, rejects with a readable error on failure. */
  test: (draft: AccountDraft) => Promise<void>
  /** Tests first, then persists. Rejects without saving if the test fails. */
  add: (draft: AccountDraft) => Promise<Account>
  remove: (id: string) => Promise<void>
  /** Set or clear the display label. Pass null/empty to clear. */
  setLabel: (id: string, label: string | null) => Promise<Account>
  /** Persist a new display order. Ids not present are kept at the end. */
  reorder: (orderedIds: string[]) => Promise<Account[]>
}

// ---------------------------------------------------------------------------
// Cached messages
// ---------------------------------------------------------------------------

export type EmailAddress = {
  name: string | null
  address: string
}

/** A single cached message in INBOX. */
export type Message = {
  accountId: string
  uid: number
  uidValidity: number
  messageId: string | null
  subject: string | null
  from: EmailAddress | null
  to: EmailAddress[]
  cc: EmailAddress[]
  /** Epoch ms — IMAP internal date or Date header. */
  date: number
  flags: string[]
  seen: boolean
  flagged: boolean
  /** Short plain-text preview (~200 chars). */
  snippet: string | null
}

/** An inline attachment referenced by a `cid:` URL inside the HTML body. */
export type InlineAttachment = {
  /** Content-ID value from the MIME part (without angle brackets). */
  contentId: string
  mime: string
  /** Base64-encoded bytes. Rendered as a `data:` URL by the renderer. */
  dataBase64: string
}

/** Full message including bodies, returned by `messages.get`. */
export type MessageWithBody = Message & {
  bodyText: string | null
  bodyHtml: string | null
  inlineAttachments: InlineAttachment[]
}

export type MessagesQuery = {
  /** Omit for the unified inbox across all accounts. */
  accountId?: string
  limit?: number
}

export type MessagesApi = {
  list: (query: MessagesQuery) => Promise<Message[]>
  get: (accountId: string, uid: number) => Promise<MessageWithBody | null>
  /** Flip the \Seen flag; updates local cache optimistically and pushes to IMAP. */
  setSeen: (accountId: string, uid: number, seen: boolean) => Promise<void>
  onChanged: (handler: () => void) => () => void
}

export type SyncApi = {
  /** Trigger an immediate sync (single account or all). */
  trigger: (accountId?: string) => Promise<void>
}
