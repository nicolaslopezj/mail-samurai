import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import {
  type AiProvider,
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
}

const DEFAULT_SETTINGS: PersistedSettings = {
  aiProvider: null,
  aiModel: null,
  encryptedKeys: {},
  retentionHours: RETENTION_DEFAULT_HOURS,
  pollIntervalMinutes: POLL_DEFAULT_MINUTES,
  loadRemoteImages: LOAD_REMOTE_IMAGES_DEFAULT
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

async function read(): Promise<PersistedSettings> {
  try {
    const raw = await readFile(settingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>
    return {
      aiProvider: parsed.aiProvider ?? null,
      aiModel: parsed.aiModel ?? null,
      encryptedKeys: parsed.encryptedKeys ?? {},
      retentionHours: clampRetention(parsed.retentionHours ?? RETENTION_DEFAULT_HOURS),
      pollIntervalMinutes: clampPollInterval(
        parsed.pollIntervalMinutes ?? POLL_DEFAULT_MINUTES
      ),
      loadRemoteImages:
        typeof parsed.loadRemoteImages === 'boolean'
          ? parsed.loadRemoteImages
          : LOAD_REMOTE_IMAGES_DEFAULT
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
    loadRemoteImages: settings.loadRemoteImages
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
