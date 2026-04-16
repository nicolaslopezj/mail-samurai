import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'
import type { AiModel, AiProvider, SettingsApi, UiSettings } from '../shared/settings'

const settings: SettingsApi = {
  get: () => ipcRenderer.invoke('settings:get') as Promise<UiSettings>,
  setProvider: (provider, model) =>
    ipcRenderer.invoke('settings:setProvider', provider, model) as Promise<UiSettings>,
  setApiKey: (provider, apiKey) =>
    ipcRenderer.invoke('settings:setApiKey', provider, apiKey) as Promise<UiSettings>,
  listModels: (provider: AiProvider, apiKey?: string) =>
    ipcRenderer.invoke('settings:listModels', provider, apiKey) as Promise<AiModel[]>
}

const api = { settings }

try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}
