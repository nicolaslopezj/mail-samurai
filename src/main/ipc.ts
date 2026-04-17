import { ipcMain } from 'electron'
import type { AccountDraft, AiProvider, Category, MessagesQuery } from '../shared/settings'
import * as accounts from './accounts-store'
import { listModels } from './ai-models'
import { setMessageSeen } from './imap-sync'
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

  ipcMain.handle('settings:setRetentionHours', async (_event, hours: number) => {
    const next = await store.setRetentionHours(hours)
    // Apply the new retention immediately (also prunes anything now out of window).
    triggerSync().catch((err) => console.error('[sync] post-retention sync failed:', err))
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

  ipcMain.handle('settings:setCategories', (_event, categories: Category[]) =>
    store.setCategories(categories)
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

  ipcMain.handle('messages:get', (_event, accountId: string, uid: number) =>
    messages.getMessage(accountId, uid)
  )

  ipcMain.handle(
    'messages:setSeen',
    async (_event, accountId: string, uid: number, seen: boolean) => {
      const changed = messages.setSeenLocal(accountId, uid, seen)
      if (changed) notifyChanged(accountId)
      const list = await accounts.list()
      const account = list.find((a) => a.id === accountId)
      if (!account) return
      setMessageSeen(account, uid, seen).catch((err) =>
        console.error(`[imap] setSeen uid=${uid} failed:`, err)
      )
    }
  )

  // Sync
  ipcMain.handle('sync:trigger', (_event, accountId?: string) => triggerSync(accountId))
}
