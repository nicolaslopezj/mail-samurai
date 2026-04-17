import { ipcMain } from 'electron'
import type {
  AccountDraft,
  AiDraftReplyRequest,
  AiProvider,
  AiReplyPreferences,
  Category,
  CategoryAction,
  CloudCredentials,
  ContactsQuery,
  EmailDraft,
  MessagesQuery,
  SummaryLanguage,
  ThemePreference
} from '../shared/settings'
import * as accounts from './accounts-store'
import { categorizeMessage } from './ai-categorize'
import { draftReply } from './ai-draft-reply'
import { listModels } from './ai-models'
import {
  connectCloud,
  disconnectCloud,
  pushCategoriesIfConnected,
  pushKvIfConnected,
  pushLocalHistory,
  pushMessageOverlay,
  syncCloudNow,
  testCloudConnection
} from './cloud-sync'
import * as contacts from './contacts-store'
import { archiveMessage, setMessageSeen, unarchiveMessage } from './imap-sync'
import { testImapAuth } from './imap-test'
import * as macContacts from './mac-contacts'
import * as messages from './messages-store'
import { KV_KEYS } from './overlay-store'
import * as store from './settings-store'
import { sendDraft } from './smtp-send'
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
    async (_event, categories: Category[], uncategorizedAction: CategoryAction) => {
      const next = await store.setCategories(categories, uncategorizedAction)
      // Fire-and-forget upload so other devices pick up the change on their
      // next pull. The helper is a no-op when the user isn't connected.
      pushCategoriesIfConnected(next.categories).catch(() => {})
      pushKvIfConnected(KV_KEYS.uncategorizedAction, next.uncategorizedAction).catch(() => {})
      return next
    }
  )

  ipcMain.handle('settings:reorderCategories', async (_event, orderedIds: string[]) => {
    const next = await store.reorderCategories(orderedIds)
    pushCategoriesIfConnected(next.categories).catch(() => {})
    return next
  })

  ipcMain.handle('settings:setTheme', (_event, theme: ThemePreference) => store.setTheme(theme))

  ipcMain.handle('settings:setSummaryLanguage', async (_event, language: SummaryLanguage) => {
    const next = await store.setSummaryLanguage(language)
    pushKvIfConnected(KV_KEYS.summaryLanguage, next.summaryLanguage).catch(() => {})
    return next
  })

  ipcMain.handle(
    'settings:setAiReplyPreferences',
    (_event, preferences: AiReplyPreferences) => store.setAiReplyPreferences(preferences)
  )

  // Cloud sync (Turso / libSQL)
  ipcMain.handle('cloud:get', async () => (await store.getUiSettings()).cloud)

  ipcMain.handle('cloud:test', async (_event, creds: CloudCredentials) => {
    await testCloudConnection(creds)
  })

  ipcMain.handle('cloud:configure', async (_event, creds: CloudCredentials) => {
    const result = await connectCloud(creds)
    notifyChanged()
    return result
  })

  ipcMain.handle('cloud:disconnect', async () => {
    const result = await disconnectCloud()
    return result
  })

  ipcMain.handle('cloud:syncNow', async () => {
    const result = await syncCloudNow()
    notifyChanged()
    return result
  })

  ipcMain.handle('cloud:pushHistory', async () => {
    return pushLocalHistory()
  })

  ipcMain.handle('cloud:setListenOnly', async (_event, enabled: boolean) => {
    const next = await store.setCloudListenOnly(enabled)
    return next.cloud
  })

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

  ipcMain.handle('messages:counts', () => messages.getCounts())

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
      // Propagate the manual re-tag to the cloud so other devices pick it up.
      const messageId = messages.getMessageId(accountId, uid)
      const message = messages.getMessage(accountId, uid)
      pushMessageOverlay(messageId, {
        categoryId,
        aiSummary: message?.aiSummary ?? null,
        categorizedAt: Date.now()
      }).catch(() => {})
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

    // Optimistic: clear archived_at_ms locally and notify *before* the IMAP
    // round-trip. The list views flip the message back to its inbox bucket
    // immediately; the server-side move and UID refresh happen in the
    // background. Mirrors the archive handler's shape.
    messages.clearArchivedLocal(accountId, uid)
    notifyChanged(accountId)

    try {
      await unarchiveMessage(account, messageId)
    } catch (err) {
      // Revert the optimistic change so the UI matches reality.
      messages.setArchivedLocal(accountId, uid, Date.now())
      notifyChanged(accountId)
      console.error(`[imap] unarchive uid=${uid} failed:`, err)
      throw err
    }

    // The local row still holds the pre-move INBOX UID, which reconcile
    // would otherwise re-archive on the next sync. Drop it, then trigger a
    // sync so the message reappears under its fresh INBOX UID. No explicit
    // notify here — the sync's own `notifyChanged` fires once the upsert
    // lands, avoiding a transient "message missing" flash between the
    // delete and the refetch.
    messages.deleteMessage(accountId, uid)
    triggerSync(accountId).catch((err) => console.error('[sync] post-unarchive sync failed:', err))
  })

  ipcMain.handle('messages:send', async (_event, draft: EmailDraft) => {
    const list = await accounts.list()
    const account = list.find((a) => a.id === draft.accountId)
    if (!account) throw new Error('Account not found.')
    await sendDraft(account, draft)
  })

  // Contacts (derived address book)
  ipcMain.handle('contacts:search', (_event, query: ContactsQuery) =>
    contacts.searchContacts(query)
  )

  // macOS Contacts integration — pulls the user's address book via
  // CNContactStore and lets the autocomplete override derived names with
  // whatever the user has locally.
  ipcMain.handle('contacts:macState', () => ({
    status: macContacts.getAuthStatus(),
    storedAddresses: macContacts.countStored(),
    lastImportedAt: macContacts.lastImportedAt()
  }))

  ipcMain.handle('contacts:macRequestAccess', async () => {
    const status = await macContacts.requestAccess()
    // Auto-import on first grant so the user gets immediate value.
    if (status === 'authorized' && macContacts.countStored() === 0) {
      try {
        await macContacts.importAll()
      } catch (err) {
        console.error('[mac-contacts] initial import failed:', err)
      }
    }
    return status
  })

  ipcMain.handle('contacts:macImport', () => macContacts.importAll())

  ipcMain.handle('contacts:macDisconnect', () => {
    macContacts.clearAll()
    return {
      status: macContacts.getAuthStatus(),
      storedAddresses: 0,
      lastImportedAt: null
    }
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
    pushMessageOverlay(message.messageId, {
      categoryId: result.categoryId,
      aiSummary: result.summary,
      categorizedAt: Date.now()
    }).catch(() => {})
    return result
  })

  ipcMain.handle('ai:draftReply', async (_event, request: AiDraftReplyRequest) => {
    const settings = await store.getUiSettings()
    if (!settings.aiProvider || !settings.aiModel) {
      throw new Error('Pick an AI provider and model in Settings first.')
    }
    const apiKey = await store.getApiKey(settings.aiProvider)
    if (!apiKey) {
      throw new Error('No API key set for the configured AI provider.')
    }
    const source = request.source
      ? messages.getMessage(request.source.accountId, request.source.uid)
      : null
    return draftReply(
      {
        source,
        userPrompt: request.userPrompt,
        mode: request.mode,
        from: request.from,
        existingBodyText: request.existingBodyText,
        preferences: settings.aiReplyPreferences
      },
      settings.aiProvider,
      settings.aiModel,
      apiKey
    )
  })
}
