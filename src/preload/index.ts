import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  Account,
  AccountDraft,
  AccountsApi,
  AiApi,
  AiModel,
  AiProvider,
  CategorizationResult,
  Category,
  CategoryAction,
  Message,
  MessageCounts,
  MessagesApi,
  MessagesQuery,
  MessageWithBody,
  SettingsApi,
  SummaryLanguage,
  SyncApi,
  ThemePreference,
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
  setSyncFromMs: (ms: number) =>
    ipcRenderer.invoke('settings:setSyncFromMs', ms) as Promise<UiSettings>,
  setPollIntervalMinutes: (minutes: number) =>
    ipcRenderer.invoke('settings:setPollIntervalMinutes', minutes) as Promise<UiSettings>,
  setLoadRemoteImages: (enabled: boolean) =>
    ipcRenderer.invoke('settings:setLoadRemoteImages', enabled) as Promise<UiSettings>,
  setCategories: (categories: Category[], uncategorizedAction: CategoryAction) =>
    ipcRenderer.invoke(
      'settings:setCategories',
      categories,
      uncategorizedAction
    ) as Promise<UiSettings>,
  reorderCategories: (orderedIds: string[]) =>
    ipcRenderer.invoke('settings:reorderCategories', orderedIds) as Promise<UiSettings>,
  setTheme: (theme: ThemePreference) =>
    ipcRenderer.invoke('settings:setTheme', theme) as Promise<UiSettings>,
  setSummaryLanguage: (language: SummaryLanguage) =>
    ipcRenderer.invoke('settings:setSummaryLanguage', language) as Promise<UiSettings>
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
  setCategory: (accountId: string, uid: number, categoryId: string | null) =>
    ipcRenderer.invoke('messages:setCategory', accountId, uid, categoryId) as Promise<void>,
  archive: (accountId: string, uid: number) =>
    ipcRenderer.invoke('messages:archive', accountId, uid) as Promise<void>,
  unarchive: (accountId: string, uid: number) =>
    ipcRenderer.invoke('messages:unarchive', accountId, uid) as Promise<void>,
  counts: () => ipcRenderer.invoke('messages:counts') as Promise<MessageCounts>,
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

const ai: AiApi = {
  categorize: (accountId: string, uid: number) =>
    ipcRenderer.invoke('ai:categorize', accountId, uid) as Promise<CategorizationResult>
}

const api = { settings, accounts, messages, sync, ai }

try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}
