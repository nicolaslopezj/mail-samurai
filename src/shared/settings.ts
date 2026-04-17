export type AiProvider = 'openai' | 'google'

export const AI_PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google Gemini' }
]

export type AiModel = {
  id: string
  label: string
}

/**
 * How long an archived message (removed from INBOX upstream) lingers in the
 * local cache before being deleted. Non-archived messages newer than
 * `syncFromMs` are kept indefinitely — this only bounds archived copies.
 */
export const ARCHIVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export const POLL_DEFAULT_MINUTES = 15
export const POLL_MIN_MINUTES = 1
export const POLL_MAX_MINUTES = 1440

export const LOAD_REMOTE_IMAGES_DEFAULT = true

/**
 * Language the AI uses for generated summaries. `auto` keeps the previous
 * behavior (detect from the email body). Any other value forces the summary
 * into that language regardless of the original email.
 */
export type SummaryLanguage = 'auto' | 'en' | 'es' | 'pt' | 'fr' | 'de' | 'it' | 'ja' | 'zh'

export const SUMMARY_LANGUAGES: {
  value: SummaryLanguage
  /** Shown in the UI dropdown. */
  label: string
  /** Passed to the model in the prompt when the user picks a fixed language. */
  promptName: string
}[] = [
  { value: 'auto', label: 'Auto (detect from email)', promptName: '' },
  { value: 'en', label: 'English', promptName: 'English' },
  { value: 'es', label: 'Español', promptName: 'Spanish' },
  { value: 'pt', label: 'Português', promptName: 'Portuguese' },
  { value: 'fr', label: 'Français', promptName: 'French' },
  { value: 'de', label: 'Deutsch', promptName: 'German' },
  { value: 'it', label: 'Italiano', promptName: 'Italian' },
  { value: 'ja', label: '日本語', promptName: 'Japanese' },
  { value: 'zh', label: '中文', promptName: 'Chinese' }
]

export const SUMMARY_LANGUAGE_DEFAULT: SummaryLanguage = 'auto'

export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_PREFERENCES: { value: ThemePreference; label: string; hint: string }[] = [
  { value: 'system', label: 'Automatic', hint: 'Follow the macOS appearance setting.' },
  { value: 'light', label: 'Force light', hint: 'Always use the light theme.' },
  { value: 'dark', label: 'Force dark', hint: 'Always use the dark theme.' }
]

export const THEME_DEFAULT: ThemePreference = 'system'

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
  /**
   * Epoch ms: the earliest date from which Mail Samurai syncs and categorizes
   * messages. Messages older than this are never cached; messages newer than
   * this are kept until they're archived upstream (and then removed locally
   * after `ARCHIVE_RETENTION_MS`).
   */
  syncFromMs: number
  /** How often the background sync runs, in minutes. */
  pollIntervalMinutes: number
  /**
   * Whether the email reader should fetch remote (http/https) images.
   * Off by default in privacy-focused clients to avoid tracking pixels —
   * we default to ON for usability but expose a setting to turn it off.
   */
  loadRemoteImages: boolean
  categories: Category[]
  /** Action applied when a message doesn't match any category. */
  uncategorizedAction: CategoryAction
  /** UI color scheme preference. `system` follows the OS setting. */
  theme: ThemePreference
  /** Language used for AI-generated summaries (`auto` = detect per email). */
  summaryLanguage: SummaryLanguage
}

export type SettingsApi = {
  get: () => Promise<UiSettings>
  setProvider: (provider: AiProvider, model: string | null) => Promise<UiSettings>
  setApiKey: (provider: AiProvider, apiKey: string) => Promise<UiSettings>
  listModels: (provider: AiProvider, apiKey?: string) => Promise<AiModel[]>
  setSyncFromMs: (ms: number) => Promise<UiSettings>
  setPollIntervalMinutes: (minutes: number) => Promise<UiSettings>
  setLoadRemoteImages: (enabled: boolean) => Promise<UiSettings>
  setCategories: (
    categories: Category[],
    uncategorizedAction: CategoryAction
  ) => Promise<UiSettings>
  setTheme: (theme: ThemePreference) => Promise<UiSettings>
  setSummaryLanguage: (language: SummaryLanguage) => Promise<UiSettings>
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
  /** User category id assigned by the AI, or null for uncategorized. */
  categoryId: string | null
  /**
   * Two-line AI-generated summary in the email's own language, written when
   * the message is categorized. Null until categorization has run — the UI
   * falls back to `snippet` in that case.
   */
  aiSummary: string | null
  /**
   * Epoch ms at which the message was last categorized (by the AI or
   * manually). Null means the message has never been categorized — distinct
   * from `categoryId === null`, which is the explicit "no matching category"
   * result.
   */
  categorizedAt: number | null
  /**
   * Epoch ms at which the message was archived (removed from INBOX upstream
   * or archived from the app). Null means it's still in INBOX.
   */
  archivedAt: number | null
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
  /** Only return messages the AI hasn't categorized yet (the Inbox bucket). */
  uncategorized?: boolean
  /** Only return categorized messages that didn't match any user category. */
  other?: boolean
  /** Only return messages assigned to this category id. */
  categoryId?: string
  /** Only return messages that have been archived (`archived_at_ms` set). */
  archived?: boolean
}

/**
 * Sidebar-badge counts. Inbox counts are unread + uncategorized (matching what
 * the inbox views actually show). `todoTotal` intentionally ignores read/unread
 * — the To-Do list is a follow-up bucket, so messages stay until explicitly
 * recategorized.
 */
export type MessageCounts = {
  /** unread & not-yet-categorized, keyed by account id. */
  inboxUnread: Record<string, number>
  /** unread & not-yet-categorized across all accounts. */
  inboxUnreadTotal: number
  /** unread messages per category id. */
  categoryUnread: Record<string, number>
  /** unread messages categorized as "other" (AI reviewed, no match). */
  otherUnread: number
  /** all messages (read or unread) whose category has a `todo` action. */
  todoTotal: number
  /** unread archived messages, keyed by account id. */
  archiveUnread: Record<string, number>
  /** unread archived messages across all accounts. */
  archiveUnreadTotal: number
}

export type MessagesApi = {
  list: (query: MessagesQuery) => Promise<Message[]>
  get: (accountId: string, uid: number) => Promise<MessageWithBody | null>
  /** Flip the \Seen flag; updates local cache optimistically and pushes to IMAP. */
  setSeen: (accountId: string, uid: number, seen: boolean) => Promise<void>
  /** Manually assign (or clear, when `categoryId` is null) the category for a message. */
  setCategory: (accountId: string, uid: number, categoryId: string | null) => Promise<void>
  /** Archive a message: move it out of INBOX upstream and mark it archived locally. */
  archive: (accountId: string, uid: number) => Promise<void>
  /** Unarchive: move the message back to INBOX and drop the stale local row. */
  unarchive: (accountId: string, uid: number) => Promise<void>
  /** Aggregate counts for sidebar badges. */
  counts: () => Promise<MessageCounts>
  onChanged: (handler: () => void) => () => void
}

export type SyncApi = {
  /** Trigger an immediate sync (single account or all). */
  trigger: (accountId?: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// AI categorization
// ---------------------------------------------------------------------------

/**
 * Result of classifying a single message against the user's categories.
 * `categoryId` is `null` when no category matched (→ uncategorized bucket).
 */
export type CategorizationResult = {
  categoryId: string | null
  reason: string
  /** Two-line summary in the email's language. Empty string when unavailable. */
  summary: string
}

export type AiApi = {
  /** Classify a cached message using the configured provider + categories. */
  categorize: (accountId: string, uid: number) => Promise<CategorizationResult>
}
