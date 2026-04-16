import { ipcMain } from 'electron'
import type { AiProvider } from '../shared/settings'
import { listModels } from './ai-models'
import * as store from './settings-store'

export function registerIpcHandlers(): void {
  ipcMain.handle('settings:get', () => store.getUiSettings())

  ipcMain.handle(
    'settings:setProvider',
    (_event, provider: AiProvider, model: string | null) => store.setProvider(provider, model)
  )

  ipcMain.handle('settings:setApiKey', (_event, provider: AiProvider, apiKey: string) =>
    store.setApiKey(provider, apiKey)
  )

  ipcMain.handle('settings:listModels', async (_event, provider: AiProvider, apiKey?: string) => {
    const key = apiKey ?? (await store.getApiKey(provider))
    if (!key) throw new Error('No API key set for this provider.')
    return listModels(provider, key)
  })
}
