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
  | { kind: 'archive' }
  | { kind: 'delete' }
  | { kind: 'moveToFolder'; folder: string }
  | { kind: 'runCommand'; command: string }

export type CategoryActionKind = CategoryAction['kind']

export const CATEGORY_ACTIONS: { value: CategoryActionKind; label: string; hint: string }[] = [
  { value: 'none', label: 'Do nothing', hint: 'Leave the message untouched in the inbox.' },
  { value: 'markRead', label: 'Mark as read', hint: 'Clear the unread flag.' },
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
 * PascalCase name of any lucide-react icon. Stored as a plain string so the
 * main process can sanitize it without pulling in the icon library — the
 * renderer resolves the name to a component dynamically.
 */
export type CategoryIcon = string

export const CATEGORY_ICON_DEFAULT: CategoryIcon = 'Tag'

/** Whether the sidebar badge shows unread-only or the total in the category. */
export type CategoryCountMode = 'unread' | 'total'

export const CATEGORY_COUNT_MODES: { value: CategoryCountMode; label: string; hint: string }[] = [
  { value: 'unread', label: 'Unread messages', hint: 'Only count messages you haven’t read yet.' },
  {
    value: 'total',
    label: 'Total messages',
    hint: 'Count every non-archived message in the category.'
  }
]

export const CATEGORY_COUNT_MODE_DEFAULT: CategoryCountMode = 'unread'

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
  icon: CategoryIcon
  countMode: CategoryCountMode
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
  /** Whether the AI may leave a message without any category match (`none`). */
  allowUncategorized: boolean
  /** Action applied when a message doesn't match any category. */
  uncategorizedAction: CategoryAction
  /** Whether the "Other" sidebar badge counts unread-only or every non-archived message. */
  uncategorizedCountMode: CategoryCountMode
  /** UI color scheme preference. `system` follows the OS setting. */
  theme: ThemePreference
  /** Language used for AI-generated summaries (`auto` = detect per email). */
  summaryLanguage: SummaryLanguage
  /** Cloud sync connection (empty/disabled when the user hasn't set one up). */
  cloud: CloudConfig
  /** User's preferences for AI-generated reply drafts. */
  aiReplyPreferences: AiReplyPreferences
}

/**
 * Preferences the AI draft-reply feature applies to every generated email.
 * Free-form instructions get pasted into the system prompt verbatim, so the
 * user can describe tone, length, signature, language quirks, or anything
 * else in plain English (or any language). Keeping it unstructured is on
 * purpose — users ask for things we can't anticipate.
 */
export type AiReplyPreferences = {
  instructions: string
}

export const AI_REPLY_PREFERENCES_DEFAULT: AiReplyPreferences = {
  instructions: ''
}

/**
 * What the renderer sees about the user's Turso / libSQL connection. The
 * auth token is never exposed to the renderer — `hasToken` is the only signal.
 * The cloud DB stores cross-device "overlays" (category + AI summary) keyed
 * by the email's RFC 5322 Message-Id; email bodies stay fully local.
 */
export type CloudConfig = {
  enabled: boolean
  /** e.g. `https://my-db-user.turso.io`. Copy-pasted from the Turso dashboard. */
  databaseUrl: string
  hasToken: boolean
  /** Epoch ms of the last successful pull from the cloud, or null before the first. */
  lastSyncedAt: number | null
  /**
   * Largest `events.id` this device has already consumed from the cloud log.
   * Per-device cursor: 0 on a fresh connect (pulls the full backlog) and
   * advances after every successful pull. Events older than the TTL have
   * already been GC'd on the cloud side, so catching up only ever sees recent ones.
   */
  lastEventId: number
  /**
   * When true, this device only *consumes* cloud events — the background AI
   * pass is disabled so it never burns tokens categorizing on its own. Useful
   * when one "primary" device handles AI and the rest are secondaries that
   * just mirror its decisions. Per-device preference; not synced.
   */
  listenOnly: boolean
}

/** Payload for `cloud.configure` — the token travels once, encrypted at rest. */
export type CloudCredentials = {
  databaseUrl: string
  authToken: string
}

export type CloudApi = {
  get: () => Promise<CloudConfig>
  /** Persist credentials, run a ping, then pull existing cloud state. */
  configure: (creds: CloudCredentials) => Promise<CloudConfig>
  /** Drop stored credentials and disable sync. */
  disconnect: () => Promise<CloudConfig>
  /**
   * Upload every locally-categorized message to the cloud event log. Call
   * from the "primary" device only — not part of the default connect flow
   * so secondary devices don't contaminate history with their local work.
   * Returns the number of events uploaded.
   */
  pushHistory: () => Promise<number>
  /** Trigger a full pull now (and push any overlays the cloud is missing). */
  syncNow: () => Promise<CloudConfig>
  /** Toggle "listen only" mode — when on, the background AI pass is skipped. */
  setListenOnly: (enabled: boolean) => Promise<CloudConfig>
  /** Round-trip `SELECT 1` without persisting anything. */
  test: (creds: CloudCredentials) => Promise<void>
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
    uncategorizedAction: CategoryAction,
    allowUncategorized: boolean,
    uncategorizedCountMode: CategoryCountMode
  ) => Promise<UiSettings>
  /** Persist a new category order. Ids not present are kept at the end. */
  reorderCategories: (orderedIds: string[]) => Promise<UiSettings>
  setTheme: (theme: ThemePreference) => Promise<UiSettings>
  setSummaryLanguage: (language: SummaryLanguage) => Promise<UiSettings>
  setAiReplyPreferences: (preferences: AiReplyPreferences) => Promise<UiSettings>
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

/**
 * Outgoing-mail presets for the providers we know about. For `custom`
 * accounts we derive an SMTP host from the IMAP host (replacing `imap` →
 * `smtp`) and default to port 465 with TLS.
 */
export const SMTP_PRESETS: Record<
  Exclude<ImapProvider, 'custom'>,
  { host: string; port: number; secure: boolean }
> = {
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  icloud: { host: 'smtp.mail.me.com', port: 587, secure: false }
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
   * One-sentence AI-generated summary in the email's own language, written when
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
  /**
   * The Inbox bucket: every non-archived message, regardless of whether the
   * AI has categorized it. Messages only leave the inbox once archived.
   */
  inbox?: boolean
  /** Only return categorized messages that didn't match any user category. */
  other?: boolean
  /** Only return messages assigned to this category id. */
  categoryId?: string
  /** Only return messages that have been archived (`archived_at_ms` set). */
  archived?: boolean
}

/**
 * Sidebar-badge counts. Inbox counts are unread non-archived messages
 * (matching what the inbox views actually show — messages stay in the inbox
 * until archived, regardless of AI categorization).
 */
export type MessageCounts = {
  /** unread non-archived, keyed by account id. */
  inboxUnread: Record<string, number>
  /** unread non-archived across all accounts. */
  inboxUnreadTotal: number
  /** unread messages per category id. */
  categoryUnread: Record<string, number>
  /** total non-archived messages per category id (read + unread). */
  categoryTotal: Record<string, number>
  /** unread messages categorized as "other" (AI reviewed, no match). */
  otherUnread: number
  /** total non-archived messages categorized as "other" (read + unread). */
  otherTotal: number
  /** unread archived messages, keyed by account id. */
  archiveUnread: Record<string, number>
  /** unread archived messages across all accounts. */
  archiveUnreadTotal: number
}

/**
 * Outgoing message composed by the user in the Compose dialog and sent over
 * SMTP. `to` is required; `cc` may be empty. `inReplyToMessageId` (the RFC
 * 2822 Message-Id of the message being replied to) lets the main process
 * set proper In-Reply-To / References headers so threads stay intact.
 */
export type EmailDraft = {
  accountId: string
  to: EmailAddress[]
  cc: EmailAddress[]
  subject: string
  bodyText: string
  bodyHtml: string | null
  /** Raw Message-Id (without angle brackets) of the message being replied to. */
  inReplyToMessageId?: string | null
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
  /** Send an email via the account's SMTP server. */
  send: (draft: EmailDraft) => Promise<void>
  /** Aggregate counts for sidebar badges. */
  counts: () => Promise<MessageCounts>
  onChanged: (handler: () => void) => () => void
}

// ---------------------------------------------------------------------------
// Contacts — derived address book, one row per (account, address).
// ---------------------------------------------------------------------------

/**
 * A contact is an email address we've interacted with via a given account.
 * Same address seen from two of your accounts shows up as two separate
 * contacts — the autocomplete can then offer account-aware suggestions.
 *
 * `displayName` is the most recent non-empty "Name" we saw for that address.
 * `sentCount` / `receivedCount` power autocomplete ranking alongside recency.
 */
export type Contact = {
  /**
   * Which of the user's email accounts interacted with this address. A
   * sentinel `__macos__` means the entry came from the macOS Contacts app
   * and we've never exchanged email with them from any local account.
   */
  accountId: string
  /** Lowercased, trimmed. Always `something@domain`. */
  address: string
  /**
   * Best available display name. If the address exists in the user's
   * macOS Contacts app, the Mac name overrides whatever shows up in
   * received email headers (the user's address book is authoritative).
   */
  displayName: string | null
  firstSeenMs: number
  lastSeenMs: number
  /** Number of times we sent something TO this address (SMTP + historical). */
  sentCount: number
  /** Number of times we received something carrying this address. */
  receivedCount: number
  /** Whether the display name came from macOS Contacts. */
  fromMacContacts: boolean
}

export type MacContactsStatus =
  /** Not macOS — the feature isn't available at all. */
  | 'unsupported'
  /** macOS, permission not asked yet. Calling `requestAccess` will prompt. */
  | 'notDetermined'
  /** Granted. Safe to call `importNow`. */
  | 'authorized'
  /** User said no. Has to re-grant in System Settings. */
  | 'denied'
  /** Blocked by parental controls / MDM. */
  | 'restricted'

export type MacContactsState = {
  status: MacContactsStatus
  /** Number of address rows currently in `mac_contacts`. */
  storedAddresses: number
  /** Epoch ms of the last successful import, or null before the first. */
  lastImportedAt: number | null
}

export type MacContactsImportResult = {
  contactsRead: number
  addressesStored: number
}

export type ContactsQuery = {
  /** Omit for a cross-account search. */
  accountId?: string
  /** Empty string returns the most-recent contacts. */
  query: string
  limit?: number
}

export type ContactsApi = {
  search: (query: ContactsQuery) => Promise<Contact[]>
  /** Current state of the macOS Contacts integration. */
  macState: () => Promise<MacContactsState>
  /** Ask macOS for permission. Returns the resulting status. */
  macRequestAccess: () => Promise<MacContactsStatus>
  /** Full refresh of imported Mac contacts. */
  macImport: () => Promise<MacContactsImportResult>
  /** Drop every imported Mac contact. */
  macDisconnect: () => Promise<MacContactsState>
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
  /** One-sentence summary in the email's language. Empty string when unavailable. */
  summary: string
}

/**
 * Request to the `ai.draftReply` handler. The renderer passes a minimal
 * `source` snapshot (from the compose dialog's state) so the main process
 * doesn't need to re-fetch the message being replied to.
 */
export type AiDraftReplyRequest = {
  userPrompt: string
  mode: 'new' | 'reply' | 'replyAll' | 'forward'
  from: EmailAddress
  existingBodyText: string
  source: {
    accountId: string
    uid: number
  } | null
}

export type AiApi = {
  /** Classify a cached message using the configured provider + categories. */
  categorize: (accountId: string, uid: number) => Promise<CategorizationResult>
  /** Generate a reply body from the user's instruction + source message. */
  draftReply: (request: AiDraftReplyRequest) => Promise<string>
}

// ---------------------------------------------------------------------------
// App meta / updates
// ---------------------------------------------------------------------------

export type UpdateStatus =
  | 'idle'
  | 'dev'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type UpdateState = {
  status: UpdateStatus
  /** The version advertised by the update server, when known. */
  version?: string
  /** Human-readable message (error text or status detail). */
  message?: string
  /** Download progress 0..1 while status === 'downloading'. */
  progress?: number
}

export type AppInfo = {
  version: string
  name: string
  homepage: string
  author: string
}

/**
 * Result of an `app.exportLogs` call. `saved` is false when the user cancels
 * the save dialog; otherwise `path` points at the file that was written.
 */
export type ExportLogsResult = {
  saved: boolean
  path?: string
}

export type AppApi = {
  info: () => Promise<AppInfo>
  getUpdateState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<UpdateState>
  /** Open an external URL in the user's default browser. */
  openExternal: (url: string) => Promise<void>
  /**
   * Bundle the app's log files with version + device info and prompt the user
   * to save it. Reveals the saved file in Finder on success.
   */
  exportLogs: () => Promise<ExportLogsResult>
  onUpdateState: (handler: (state: UpdateState) => void) => () => void
}
