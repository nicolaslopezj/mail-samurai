import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  Account,
  AccountDraft,
  AccountsApi,
  AiApi,
  AiDraftReplyRequest,
  AiModel,
  AiProvider,
  AiReplyPreferences,
  CategorizationResult,
  Category,
  CategoryAction,
  CloudApi,
  CloudConfig,
  CloudCredentials,
  Contact,
  ContactsApi,
  ContactsQuery,
  EmailDraft,
  MacContactsImportResult,
  MacContactsState,
  MacContactsStatus,
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
    ipcRenderer.invoke('settings:setSummaryLanguage', language) as Promise<UiSettings>,
  setAiReplyPreferences: (preferences: AiReplyPreferences) =>
    ipcRenderer.invoke(
      'settings:setAiReplyPreferences',
      preferences
    ) as Promise<UiSettings>
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
  send: (draft: EmailDraft) => ipcRenderer.invoke('messages:send', draft) as Promise<void>,
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
    ipcRenderer.invoke('ai:categorize', accountId, uid) as Promise<CategorizationResult>,
  draftReply: (request: AiDraftReplyRequest) =>
    ipcRenderer.invoke('ai:draftReply', request) as Promise<string>
}

const contacts: ContactsApi = {
  search: (query: ContactsQuery) =>
    ipcRenderer.invoke('contacts:search', query) as Promise<Contact[]>,
  macState: () => ipcRenderer.invoke('contacts:macState') as Promise<MacContactsState>,
  macRequestAccess: () =>
    ipcRenderer.invoke('contacts:macRequestAccess') as Promise<MacContactsStatus>,
  macImport: () => ipcRenderer.invoke('contacts:macImport') as Promise<MacContactsImportResult>,
  macDisconnect: () => ipcRenderer.invoke('contacts:macDisconnect') as Promise<MacContactsState>
}

const cloud: CloudApi = {
  get: () => ipcRenderer.invoke('cloud:get') as Promise<CloudConfig>,
  test: (creds: CloudCredentials) => ipcRenderer.invoke('cloud:test', creds) as Promise<void>,
  configure: (creds: CloudCredentials) =>
    ipcRenderer.invoke('cloud:configure', creds) as Promise<CloudConfig>,
  disconnect: () => ipcRenderer.invoke('cloud:disconnect') as Promise<CloudConfig>,
  pushHistory: () => ipcRenderer.invoke('cloud:pushHistory') as Promise<number>,
  syncNow: () => ipcRenderer.invoke('cloud:syncNow') as Promise<CloudConfig>,
  setListenOnly: (enabled: boolean) =>
    ipcRenderer.invoke('cloud:setListenOnly', enabled) as Promise<CloudConfig>
}

const api = { settings, accounts, messages, sync, ai, contacts, cloud }

try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}
