import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import {
  AI_REPLY_PREFERENCES_DEFAULT,
  type AiProvider,
  type AiReplyPreferences,
  CATEGORY_COUNT_MODE_DEFAULT,
  CATEGORY_COUNT_MODES,
  CATEGORY_ICON_DEFAULT,
  type Category,
  type CategoryAction,
  type CategoryCountMode,
  type CategoryIcon,
  type CloudConfig,
  LOAD_REMOTE_IMAGES_DEFAULT,
  POLL_DEFAULT_MINUTES,
  POLL_MAX_MINUTES,
  POLL_MIN_MINUTES,
  SUMMARY_LANGUAGE_DEFAULT,
  SUMMARY_LANGUAGES,
  type SummaryLanguage,
  THEME_DEFAULT,
  type ThemePreference,
  type UiSettings
} from '../shared/settings'

const AI_REPLY_INSTRUCTIONS_MAX = 4000

type PersistedCloud = {
  enabled: boolean
  /** Turso / libSQL HTTP URL, e.g. `https://my-db-user.turso.io`. */
  databaseUrl: string
  /** Encrypted auth token, base64-encoded. */
  encryptedToken: string | null
  lastSyncedAt: number | null
  lastEventId: number
  listenOnly: boolean
}

type PersistedSettings = {
  aiProvider: AiProvider | null
  aiModel: string | null
  /** Per-provider encrypted API key, base64-encoded. */
  encryptedKeys: Partial<Record<AiProvider, string>>
  syncFromMs: number
  pollIntervalMinutes: number
  loadRemoteImages: boolean
  categories: Category[]
  allowUncategorized: boolean
  uncategorizedAction: CategoryAction
  uncategorizedCountMode: CategoryCountMode
  theme: ThemePreference
  summaryLanguage: SummaryLanguage
  cloud: PersistedCloud
  aiReplyPreferences: AiReplyPreferences
}

function emptyCloud(): PersistedCloud {
  return {
    enabled: false,
    databaseUrl: '',
    encryptedToken: null,
    lastSyncedAt: null,
    lastEventId: 0,
    listenOnly: false
  }
}

function sanitizeCloud(value: unknown): PersistedCloud {
  if (!value || typeof value !== 'object') return emptyCloud()
  const raw = value as Partial<PersistedCloud>
  return {
    enabled: Boolean(raw.enabled),
    databaseUrl: typeof raw.databaseUrl === 'string' ? raw.databaseUrl.trim() : '',
    encryptedToken:
      typeof raw.encryptedToken === 'string' && raw.encryptedToken.length > 0
        ? raw.encryptedToken
        : null,
    lastSyncedAt: typeof raw.lastSyncedAt === 'number' ? raw.lastSyncedAt : null,
    lastEventId: typeof raw.lastEventId === 'number' ? raw.lastEventId : 0,
    listenOnly: Boolean(raw.listenOnly)
  }
}

/**
 * Build the settings that get persisted the very first time the app runs.
 * `syncFromMs` is pinned to the install moment so categorization starts from
 * here; later reads see the stored value, not a moving default.
 */
function makeInitialSettings(): PersistedSettings {
  return {
    aiProvider: null,
    aiModel: null,
    encryptedKeys: {},
    syncFromMs: Date.now(),
    pollIntervalMinutes: POLL_DEFAULT_MINUTES,
    loadRemoteImages: LOAD_REMOTE_IMAGES_DEFAULT,
    categories: [],
    allowUncategorized: true,
    uncategorizedAction: { kind: 'none' },
    uncategorizedCountMode: CATEGORY_COUNT_MODE_DEFAULT,
    theme: THEME_DEFAULT,
    summaryLanguage: SUMMARY_LANGUAGE_DEFAULT,
    cloud: emptyCloud(),
    aiReplyPreferences: { ...AI_REPLY_PREFERENCES_DEFAULT }
  }
}

function sanitizeTheme(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : THEME_DEFAULT
}

function sanitizeAiReplyPreferences(value: unknown): AiReplyPreferences {
  if (!value || typeof value !== 'object') return { ...AI_REPLY_PREFERENCES_DEFAULT }
  const raw = value as Partial<AiReplyPreferences>
  const instructions =
    typeof raw.instructions === 'string'
      ? raw.instructions.trim().slice(0, AI_REPLY_INSTRUCTIONS_MAX)
      : ''
  return { instructions }
}

function sanitizeSummaryLanguage(value: unknown): SummaryLanguage {
  return SUMMARY_LANGUAGES.some((l) => l.value === value)
    ? (value as SummaryLanguage)
    : SUMMARY_LANGUAGE_DEFAULT
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function sanitizeSyncFromMs(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return Date.now()
  const rounded = Math.round(n)
  // Clamp to a sane window: no earlier than 1970, no later than now.
  if (rounded < 0) return 0
  const now = Date.now()
  if (rounded > now) return now
  return rounded
}

function clampPollInterval(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return POLL_DEFAULT_MINUTES
  const rounded = Math.round(n)
  if (rounded < POLL_MIN_MINUTES) return POLL_MIN_MINUTES
  if (rounded > POLL_MAX_MINUTES) return POLL_MAX_MINUTES
  return rounded
}

function sanitizeAction(value: unknown): CategoryAction {
  if (!value || typeof value !== 'object') return { kind: 'none' }
  const raw = value as { kind?: unknown; folder?: unknown; command?: unknown }
  switch (raw.kind) {
    case 'markRead':
    case 'archive':
    case 'delete':
    case 'none':
      return { kind: raw.kind }
    case 'moveToFolder': {
      const folder = typeof raw.folder === 'string' ? raw.folder.trim() : ''
      if (!folder) return { kind: 'none' }
      return { kind: 'moveToFolder', folder }
    }
    case 'runCommand': {
      const command = typeof raw.command === 'string' ? raw.command.trim() : ''
      if (!command) return { kind: 'none' }
      return { kind: 'runCommand', command }
    }
    default:
      return { kind: 'none' }
  }
}

function sanitizeIcon(value: unknown): CategoryIcon {
  if (typeof value !== 'string') return CATEGORY_ICON_DEFAULT
  const trimmed = value.trim()
  return /^[A-Z][A-Za-z0-9]{0,63}$/.test(trimmed) ? trimmed : CATEGORY_ICON_DEFAULT
}

function sanitizeCountMode(value: unknown): CategoryCountMode {
  return CATEGORY_COUNT_MODES.some((m) => m.value === value)
    ? (value as CategoryCountMode)
    : CATEGORY_COUNT_MODE_DEFAULT
}

function sanitizeCategories(value: unknown): Category[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: Category[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const raw = entry as Partial<Category>
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const instructions = typeof raw.instructions === 'string' ? raw.instructions.trim() : ''
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    result.push({
      id,
      name,
      instructions,
      action: sanitizeAction(raw.action),
      icon: sanitizeIcon(raw.icon),
      countMode: sanitizeCountMode(raw.countMode)
    })
  }
  return result
}

async function read(): Promise<PersistedSettings> {
  try {
    const raw = await readFile(settingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>
    return {
      aiProvider: parsed.aiProvider ?? null,
      aiModel: parsed.aiModel ?? null,
      encryptedKeys: parsed.encryptedKeys ?? {},
      syncFromMs: sanitizeSyncFromMs(parsed.syncFromMs),
      pollIntervalMinutes: clampPollInterval(parsed.pollIntervalMinutes ?? POLL_DEFAULT_MINUTES),
      loadRemoteImages:
        typeof parsed.loadRemoteImages === 'boolean'
          ? parsed.loadRemoteImages
          : LOAD_REMOTE_IMAGES_DEFAULT,
      categories: sanitizeCategories(parsed.categories),
      allowUncategorized:
        typeof parsed.allowUncategorized === 'boolean' ? parsed.allowUncategorized : true,
      uncategorizedAction: sanitizeAction(parsed.uncategorizedAction),
      uncategorizedCountMode: sanitizeCountMode(parsed.uncategorizedCountMode),
      theme: sanitizeTheme(parsed.theme),
      summaryLanguage: sanitizeSummaryLanguage(parsed.summaryLanguage),
      cloud: sanitizeCloud(parsed.cloud),
      aiReplyPreferences: sanitizeAiReplyPreferences(parsed.aiReplyPreferences)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return makeInitialSettings()
    throw err
  }
}

async function write(settings: PersistedSettings): Promise<void> {
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
}

/**
 * Write the initial settings file if it doesn't exist yet. Run once at
 * startup so `syncFromMs` is pinned to the very first launch — later reads
 * return the stored value instead of a moving default.
 */
export async function initSettings(): Promise<void> {
  try {
    await access(settingsPath())
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await write(makeInitialSettings())
      return
    }
    throw err
  }
}

function toUi(settings: PersistedSettings): UiSettings {
  return {
    aiProvider: settings.aiProvider,
    aiModel: settings.aiModel,
    hasKey: {
      openai: Boolean(settings.encryptedKeys.openai),
      google: Boolean(settings.encryptedKeys.google)
    },
    syncFromMs: settings.syncFromMs,
    pollIntervalMinutes: settings.pollIntervalMinutes,
    loadRemoteImages: settings.loadRemoteImages,
    categories: settings.categories,
    allowUncategorized: settings.allowUncategorized,
    uncategorizedAction: settings.uncategorizedAction,
    uncategorizedCountMode: settings.uncategorizedCountMode,
    theme: settings.theme,
    summaryLanguage: settings.summaryLanguage,
    cloud: toCloudUi(settings.cloud),
    aiReplyPreferences: settings.aiReplyPreferences
  }
}

function toCloudUi(cloud: PersistedCloud): CloudConfig {
  return {
    enabled: cloud.enabled,
    databaseUrl: cloud.databaseUrl,
    hasToken: Boolean(cloud.encryptedToken),
    lastSyncedAt: cloud.lastSyncedAt,
    lastEventId: cloud.lastEventId,
    listenOnly: cloud.listenOnly
  }
}

export async function getUiSettings(): Promise<UiSettings> {
  return toUi(await read())
}

export async function setProvider(provider: AiProvider, model: string | null): Promise<UiSettings> {
  const current = await read()
  const next: PersistedSettings = { ...current, aiProvider: provider, aiModel: model }
  await write(next)
  return toUi(next)
}

export async function setApiKey(provider: AiProvider, apiKey: string): Promise<UiSettings> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is not available; cannot store API key safely.')
  }
  const current = await read()
  const encrypted = safeStorage.encryptString(apiKey).toString('base64')
  const next: PersistedSettings = {
    ...current,
    encryptedKeys: { ...current.encryptedKeys, [provider]: encrypted }
  }
  await write(next)
  return toUi(next)
}

export async function getApiKey(provider: AiProvider): Promise<string | null> {
  const settings = await read()
  const blob = settings.encryptedKeys[provider]
  if (!blob) return null
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is not available; cannot read stored API key.')
  }
  return safeStorage.decryptString(Buffer.from(blob, 'base64'))
}

export async function setSyncFromMs(ms: number): Promise<UiSettings> {
  const current = await read()
  const next: PersistedSettings = { ...current, syncFromMs: sanitizeSyncFromMs(ms) }
  await write(next)
  return toUi(next)
}

export async function getSyncFromMs(): Promise<number> {
  return (await read()).syncFromMs
}

export async function setPollIntervalMinutes(minutes: number): Promise<UiSettings> {
  const current = await read()
  const next: PersistedSettings = {
    ...current,
    pollIntervalMinutes: clampPollInterval(minutes)
  }
  await write(next)
  return toUi(next)
}

export async function getPollIntervalMinutes(): Promise<number> {
  return (await read()).pollIntervalMinutes
}

export async function setLoadRemoteImages(enabled: boolean): Promise<UiSettings> {
  const current = await read()
  const next: PersistedSettings = { ...current, loadRemoteImages: Boolean(enabled) }
  await write(next)
  return toUi(next)
}

export async function setCategories(
  categories: Category[],
  uncategorizedAction: CategoryAction,
  allowUncategorized: boolean,
  uncategorizedCountMode: CategoryCountMode
): Promise<UiSettings> {
  const current = await read()
  const next: PersistedSettings = {
    ...current,
    categories: sanitizeCategories(categories),
    allowUncategorized: Boolean(allowUncategorized),
    uncategorizedAction: sanitizeAction(uncategorizedAction),
    uncategorizedCountMode: sanitizeCountMode(uncategorizedCountMode)
  }
  await write(next)
  return toUi(next)
}

export async function reorderCategories(orderedIds: string[]): Promise<UiSettings> {
  const current = await read()
  const byId = new Map(current.categories.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const reordered: Category[] = []
  for (const id of orderedIds) {
    const category = byId.get(id)
    if (!category || seen.has(id)) continue
    seen.add(id)
    reordered.push(category)
  }
  // Keep any ids the renderer didn't include at their original relative position.
  for (const category of current.categories) {
    if (!seen.has(category.id)) reordered.push(category)
  }
  const next: PersistedSettings = { ...current, categories: reordered }
  await write(next)
  return toUi(next)
}

export async function setTheme(theme: ThemePreference): Promise<UiSettings> {
  const current = await read()
  const next: PersistedSettings = { ...current, theme: sanitizeTheme(theme) }
  await write(next)
  return toUi(next)
}

export async function setSummaryLanguage(language: SummaryLanguage): Promise<UiSettings> {
  const current = await read()
  const next: PersistedSettings = {
    ...current,
    summaryLanguage: sanitizeSummaryLanguage(language)
  }
  await write(next)
  return toUi(next)
}

export async function getSummaryLanguage(): Promise<SummaryLanguage> {
  return (await read()).summaryLanguage
}

export async function setAiReplyPreferences(preferences: AiReplyPreferences): Promise<UiSettings> {
  const current = await read()
  const next: PersistedSettings = {
    ...current,
    aiReplyPreferences: sanitizeAiReplyPreferences(preferences)
  }
  await write(next)
  return toUi(next)
}

export async function getAiReplyPreferences(): Promise<AiReplyPreferences> {
  return (await read()).aiReplyPreferences
}

// ---------------------------------------------------------------------------
// Cloud (Cloudflare D1) credentials
// ---------------------------------------------------------------------------

/**
 * Persist D1 credentials. The API token is encrypted via safeStorage before
 * touching disk — same pattern as IMAP passwords and AI provider keys.
 * Marks the connection as enabled; callers that want "disabled" use
 * `disconnectCloud` instead.
 */
export async function setCloudCredentials(
  databaseUrl: string,
  authToken: string
): Promise<UiSettings> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is not available; cannot store the cloud token safely.')
  }
  const current = await read()
  const encryptedToken = safeStorage.encryptString(authToken).toString('base64')
  const next: PersistedSettings = {
    ...current,
    cloud: {
      enabled: true,
      databaseUrl: databaseUrl.trim(),
      encryptedToken,
      // Reset both the pull clock and the event cursor so the first
      // syncCloudNow after a (re)connect replays the whole event backlog.
      lastSyncedAt: null,
      lastEventId: 0,
      // Preserve the user's "listen-only" preference across reconnects.
      listenOnly: current.cloud.listenOnly
    }
  }
  await write(next)
  return toUi(next)
}

export async function disconnectCloud(): Promise<UiSettings> {
  const current = await read()
  const next: PersistedSettings = { ...current, cloud: emptyCloud() }
  await write(next)
  return toUi(next)
}

/**
 * Load the plaintext credentials for the main process. Returns null when the
 * user hasn't connected yet or when the token can't be decrypted (e.g. moved
 * the settings file across machines, where safeStorage keys differ).
 */
export async function getCloudCredentials(): Promise<{
  databaseUrl: string
  authToken: string
} | null> {
  const settings = await read()
  const { cloud } = settings
  if (!cloud.enabled || !cloud.encryptedToken || !cloud.databaseUrl) {
    return null
  }
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const authToken = safeStorage.decryptString(Buffer.from(cloud.encryptedToken, 'base64'))
    return { databaseUrl: cloud.databaseUrl, authToken }
  } catch (err) {
    console.error('[settings] could not decrypt cloud token:', err)
    return null
  }
}

export async function setCloudLastSyncedAt(ms: number): Promise<void> {
  const current = await read()
  const next: PersistedSettings = {
    ...current,
    cloud: { ...current.cloud, lastSyncedAt: ms }
  }
  await write(next)
}

/** Toggle the per-device "listen-only" flag. Preserved across reconnects. */
export async function setCloudListenOnly(enabled: boolean): Promise<UiSettings> {
  const current = await read()
  const next: PersistedSettings = {
    ...current,
    cloud: { ...current.cloud, listenOnly: Boolean(enabled) }
  }
  await write(next)
  return toUi(next)
}

/** Advance the cloud event cursor. Monotonic — callers should never decrease it. */
export async function setCloudLastEventId(id: number): Promise<void> {
  const current = await read()
  if (id <= current.cloud.lastEventId) return
  const next: PersistedSettings = {
    ...current,
    cloud: { ...current.cloud, lastEventId: id }
  }
  await write(next)
}
