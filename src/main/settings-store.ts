import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import {
  type AiProvider,
  type Category,
  type CategoryAction,
  LOAD_REMOTE_IMAGES_DEFAULT,
  POLL_DEFAULT_MINUTES,
  POLL_MAX_MINUTES,
  POLL_MIN_MINUTES,
  RETENTION_DEFAULT_HOURS,
  RETENTION_MAX_HOURS,
  RETENTION_MIN_HOURS,
  type UiSettings
} from '../shared/settings'

type PersistedSettings = {
  aiProvider: AiProvider | null
  aiModel: string | null
  /** Per-provider encrypted API key, base64-encoded. */
  encryptedKeys: Partial<Record<AiProvider, string>>
  retentionHours: number
  pollIntervalMinutes: number
  loadRemoteImages: boolean
  categories: Category[]
}

const DEFAULT_SETTINGS: PersistedSettings = {
  aiProvider: null,
  aiModel: null,
  encryptedKeys: {},
  retentionHours: RETENTION_DEFAULT_HOURS,
  pollIntervalMinutes: POLL_DEFAULT_MINUTES,
  loadRemoteImages: LOAD_REMOTE_IMAGES_DEFAULT,
  categories: []
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function clampRetention(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return RETENTION_DEFAULT_HOURS
  const rounded = Math.round(n)
  if (rounded < RETENTION_MIN_HOURS) return RETENTION_MIN_HOURS
  if (rounded > RETENTION_MAX_HOURS) return RETENTION_MAX_HOURS
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
    case 'todo':
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
    result.push({ id, name, instructions, action: sanitizeAction(raw.action) })
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
      retentionHours: clampRetention(parsed.retentionHours ?? RETENTION_DEFAULT_HOURS),
      pollIntervalMinutes: clampPollInterval(parsed.pollIntervalMinutes ?? POLL_DEFAULT_MINUTES),
      loadRemoteImages:
        typeof parsed.loadRemoteImages === 'boolean'
          ? parsed.loadRemoteImages
          : LOAD_REMOTE_IMAGES_DEFAULT,
      categories: sanitizeCategories(parsed.categories)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_SETTINGS }
    throw err
  }
}

async function write(settings: PersistedSettings): Promise<void> {
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
}

function toUi(settings: PersistedSettings): UiSettings {
  return {
    aiProvider: settings.aiProvider,
    aiModel: settings.aiModel,
    hasKey: {
      openai: Boolean(settings.encryptedKeys.openai),
      google: Boolean(settings.encryptedKeys.google)
    },
    retentionHours: settings.retentionHours,
    pollIntervalMinutes: settings.pollIntervalMinutes,
    loadRemoteImages: settings.loadRemoteImages,
    categories: settings.categories
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

export async function setRetentionHours(hours: number): Promise<UiSettings> {
  const current = await read()
  const next: PersistedSettings = { ...current, retentionHours: clampRetention(hours) }
  await write(next)
  return toUi(next)
}

export async function getRetentionHours(): Promise<number> {
  return (await read()).retentionHours
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

export async function setCategories(categories: Category[]): Promise<UiSettings> {
  const current = await read()
  const next: PersistedSettings = { ...current, categories: sanitizeCategories(categories) }
  await write(next)
  return toUi(next)
}
