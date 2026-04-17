import { ipcMain } from 'electron'
import type {
  AccountDraft,
  AiProvider,
  Category,
  CategoryAction,
  MessagesQuery,
  SummaryLanguage,
  ThemePreference
} from '../shared/settings'
import * as accounts from './accounts-store'
import { categorizeMessage } from './ai-categorize'
import { listModels } from './ai-models'
import { archiveMessage, setMessageSeen, unarchiveMessage } from './imap-sync'
import { testImapAuth } from './imap-test'
import * as messages from './messages-store'
import * as store from './settings-store'
import { notifyChanged, reloadInterval, triggerSync } from './sync-scheduler'

export function registerIpcHandlers(): void {
  // AI / general settings
  ipcMain.handle('settings:get', () => store.getUiSettings())

  ipcMain.handle('settings:setProvider', (_event, provider: AiProvider, model: string | null) =>
    store.setProvider(provider, model)
  )

  ipcMain.handle('settings:setApiKey', (_event, provider: AiProvider, apiKey: string) =>
    store.setApiKey(provider, apiKey)
  )

  ipcMain.handle('settings:listModels', async (_event, provider: AiProvider, apiKey?: string) => {
    const key = apiKey ?? (await store.getApiKey(provider))
    if (!key) throw new Error('No API key set for this provider.')
    return listModels(provider, key)
  })

  ipcMain.handle('settings:setSyncFromMs', async (_event, ms: number) => {
    const next = await store.setSyncFromMs(ms)
    // Apply the new sync window immediately: drops messages that fell out
    // of scope and pulls anything newly in scope.
    triggerSync().catch((err) => console.error('[sync] post-syncFrom sync failed:', err))
    return next
  })

  ipcMain.handle('settings:setPollIntervalMinutes', async (_event, minutes: number) => {
    const next = await store.setPollIntervalMinutes(minutes)
    reloadInterval().catch((err) => console.error('[sync] failed to reload interval:', err))
    return next
  })

  ipcMain.handle('settings:setLoadRemoteImages', (_event, enabled: boolean) =>
    store.setLoadRemoteImages(enabled)
  )

  ipcMain.handle(
    'settings:setCategories',
    (_event, categories: Category[], uncategorizedAction: CategoryAction) =>
      store.setCategories(categories, uncategorizedAction)
  )

  ipcMain.handle('settings:setTheme', (_event, theme: ThemePreference) => store.setTheme(theme))

  ipcMain.handle('settings:setSummaryLanguage', (_event, language: SummaryLanguage) =>
    store.setSummaryLanguage(language)
  )

  // Email accounts
  ipcMain.handle('accounts:list', () => accounts.list())

  ipcMain.handle('accounts:test', async (_event, draft: AccountDraft) => {
    await testImapAuth(draft)
  })

  ipcMain.handle('accounts:add', async (_event, draft: AccountDraft) => {
    await testImapAuth(draft)
    const account = await accounts.add(draft)
    // Kick off a first sync for the new account.
    triggerSync(account.id).catch((err) =>
      console.error(`[sync] initial sync for ${account.email} failed:`, err)
    )
    return account
  })

  ipcMain.handle('accounts:remove', (_event, id: string) => accounts.remove(id))

  ipcMain.handle('accounts:setLabel', (_event, id: string, label: string | null) =>
    accounts.setLabel(id, label)
  )

  ipcMain.handle('accounts:reorder', (_event, orderedIds: string[]) => accounts.reorder(orderedIds))

  // Messages
  ipcMain.handle('messages:list', (_event, query: MessagesQuery) => messages.listMessages(query))

  ipcMain.handle('messages:counts', async () => {
    const settings = await store.getUiSettings()
    const todoIds = settings.categories.filter((c) => c.action.kind === 'todo').map((c) => c.id)
    return messages.getCounts(todoIds)
  })

  ipcMain.handle('messages:get', (_event, accountId: string, uid: number) =>
    messages.getMessage(accountId, uid)
  )

  ipcMain.handle(
    'messages:setSeen',
    async (_event, accountId: string, uid: number, seen: boolean) => {
      messages.setSeenLocal(accountId, uid, seen)
      notifyChanged(accountId)
      const list = await accounts.list()
      const account = list.find((a) => a.id === accountId)
      if (!account) return
      setMessageSeen(account, uid, seen).catch((err) =>
        console.error(`[imap] setSeen uid=${uid} failed:`, err)
      )
    }
  )

  ipcMain.handle(
    'messages:setCategory',
    (_event, accountId: string, uid: number, categoryId: string | null) => {
      messages.setCategory(accountId, uid, categoryId)
      notifyChanged(accountId)
    }
  )

  ipcMain.handle('messages:archive', async (_event, accountId: string, uid: number) => {
    messages.setArchivedLocal(accountId, uid, Date.now())
    notifyChanged(accountId)
    const list = await accounts.list()
    const account = list.find((a) => a.id === accountId)
    if (!account) return
    try {
      await archiveMessage(account, uid)
    } catch (err) {
      console.error(`[imap] archive uid=${uid} failed:`, err)
      throw err
    }
  })

  ipcMain.handle('messages:unarchive', async (_event, accountId: string, uid: number) => {
    const messageId = messages.getMessageId(accountId, uid)
    if (!messageId) throw new Error('Message has no Message-Id; cannot unarchive.')
    const list = await accounts.list()
    const account = list.find((a) => a.id === accountId)
    if (!account) throw new Error('Account not found.')
    // IMAP first — a failure here leaves the local cache untouched. Only
    // after the server-side move succeeds do we drop the stale row and
    // trigger a sync so the message is refetched under its new INBOX UID.
    await unarchiveMessage(account, messageId)
    messages.deleteMessage(accountId, uid)
    notifyChanged(accountId)
    triggerSync(accountId).catch((err) =>
      console.error('[sync] post-unarchive sync failed:', err)
    )
  })

  // Sync
  ipcMain.handle('sync:trigger', (_event, accountId?: string) => triggerSync(accountId))

  // AI
  ipcMain.handle('ai:categorize', async (_event, accountId: string, uid: number) => {
    const settings = await store.getUiSettings()
    if (!settings.aiProvider || !settings.aiModel) {
      throw new Error('Pick an AI provider and model in Settings first.')
    }
    const apiKey = await store.getApiKey(settings.aiProvider)
    if (!apiKey) {
      throw new Error('No API key set for the configured AI provider.')
    }
    const message = messages.getMessage(accountId, uid)
    if (!message) {
      throw new Error('Message not found locally.')
    }
    const result = await categorizeMessage(
      message,
      settings.categories,
      settings.aiProvider,
      settings.aiModel,
      apiKey,
      settings.summaryLanguage
    )
    messages.setCategory(accountId, uid, result.categoryId)
    messages.setAiSummary(accountId, uid, result.summary)
    notifyChanged(accountId)
    return result
  })
}
