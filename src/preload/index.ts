import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  Account,
  AccountDraft,
  AccountsApi,
  AiModel,
  AiProvider,
  Category,
  Message,
  MessagesApi,
  MessagesQuery,
  MessageWithBody,
  SettingsApi,
  SyncApi,
  UiSettings
} from '../shared/settings'

const settings: SettingsApi = {
  get: () => ipcRenderer.invoke('settings:get') as Promise<UiSettings>,
  setProvider: (provider, model) =>
    ipcRenderer.invoke('settings:setProvider', provider, model) as Promise<UiSettings>,
  setApiKey: (provider, apiKey) =>
    ipcRenderer.invoke('settings:setApiKey', provider, apiKey) as Promise<UiSettings>,
  listModels: (provider: AiProvider, apiKey?: string) =>
    ipcRenderer.invoke('settings:listModels', provider, apiKey) as Promise<AiModel[]>,
  setRetentionHours: (hours: number) =>
    ipcRenderer.invoke('settings:setRetentionHours', hours) as Promise<UiSettings>,
  setPollIntervalMinutes: (minutes: number) =>
    ipcRenderer.invoke('settings:setPollIntervalMinutes', minutes) as Promise<UiSettings>,
  setLoadRemoteImages: (enabled: boolean) =>
    ipcRenderer.invoke('settings:setLoadRemoteImages', enabled) as Promise<UiSettings>,
  setCategories: (categories: Category[]) =>
    ipcRenderer.invoke('settings:setCategories', categories) as Promise<UiSettings>
}

const accounts: AccountsApi = {
  list: () => ipcRenderer.invoke('accounts:list') as Promise<Account[]>,
  test: (draft: AccountDraft) => ipcRenderer.invoke('accounts:test', draft) as Promise<void>,
  add: (draft: AccountDraft) => ipcRenderer.invoke('accounts:add', draft) as Promise<Account>,
  remove: (id: string) => ipcRenderer.invoke('accounts:remove', id) as Promise<void>,
  setLabel: (id: string, label: string | null) =>
    ipcRenderer.invoke('accounts:setLabel', id, label) as Promise<Account>,
  reorder: (orderedIds: string[]) =>
    ipcRenderer.invoke('accounts:reorder', orderedIds) as Promise<Account[]>
}

const messages: MessagesApi = {
  list: (query: MessagesQuery) => ipcRenderer.invoke('messages:list', query) as Promise<Message[]>,
  get: (accountId: string, uid: number) =>
    ipcRenderer.invoke('messages:get', accountId, uid) as Promise<MessageWithBody | null>,
  setSeen: (accountId: string, uid: number, seen: boolean) =>
    ipcRenderer.invoke('messages:setSeen', accountId, uid, seen) as Promise<void>,
  onChanged: (handler: () => void) => {
    const listener = (): void => handler()
    ipcRenderer.on('messages:changed', listener)
    return () => {
      ipcRenderer.removeListener('messages:changed', listener)
    }
  }
}

const sync: SyncApi = {
  trigger: (accountId?: string) => ipcRenderer.invoke('sync:trigger', accountId) as Promise<void>
}

const api = { settings, accounts, messages, sync }

try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}
