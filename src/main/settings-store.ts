import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { AiProvider, UiSettings } from '../shared/settings'

type PersistedSettings = {
  aiProvider: AiProvider | null
  aiModel: string | null
  /** Per-provider encrypted API key, base64-encoded. */
  encryptedKeys: Partial<Record<AiProvider, string>>
}

const DEFAULT_SETTINGS: PersistedSettings = {
  aiProvider: null,
  aiModel: null,
  encryptedKeys: {}
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function read(): Promise<PersistedSettings> {
  try {
    const raw = await readFile(settingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>
    return {
      aiProvider: parsed.aiProvider ?? null,
      aiModel: parsed.aiModel ?? null,
      encryptedKeys: parsed.encryptedKeys ?? {}
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
    }
  }
}

export async function getUiSettings(): Promise<UiSettings> {
  return toUi(await read())
}

export async function setProvider(
  provider: AiProvider,
  model: string | null
): Promise<UiSettings> {
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
