import { BrowserWindow } from 'electron'
import { list as listAccounts } from './accounts-store'
import { categorizeMessage } from './ai-categorize'
import { applyCategoryAction, resolveCategoryAction } from './category-actions'
import { pushMessageOverlay, syncCloudNow } from './cloud-sync'
import { getMessage, listUncategorizedRefs, setAiSummary, setCategory } from './messages-store'
import { getApiKey, getUiSettings } from './settings-store'

const MAX_PER_PASS = 100
const NOTIFY_EVERY = 3

let running = false

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('messages:changed', {})
  }
}

/**
 * Review every cached message the AI hasn't seen yet — assigns a category
 * and writes the one-sentence summary. Runs over archived messages too: the user
 * wants AI data persisted regardless of inbox state.
 *
 * No-op when the AI provider/model/key isn't configured. Serialized via
 * `running` so overlapping sync passes don't trigger parallel model calls.
 */
export async function categorizePendingMessages(): Promise<void> {
  if (running) return
  running = true
  try {
    const settings = await getUiSettings()

    // Listen-only devices still need to pull cloud events (otherwise they'd
    // never catch decisions made by the primary), but they must not call the
    // model themselves. Pull, then bail before the categorization loop.
    if (settings.cloud.enabled && settings.cloud.listenOnly) {
      await syncCloudNow()
      return
    }

    if (!settings.aiProvider || !settings.aiModel) return
    const apiKey = await getApiKey(settings.aiProvider)
    if (!apiKey) return

    // Pull any events from the cloud first so messages already categorized
    // on another device get flagged locally (category_id + categorized_at)
    // and drop out of `listUncategorizedRefs`. No-op when not connected.
    if (settings.cloud.enabled) {
      await syncCloudNow()
    }

    const refs = listUncategorizedRefs(MAX_PER_PASS)
    if (refs.length === 0) return

    const accounts = await listAccounts()
    const accountsById = new Map(accounts.map((a) => [a.id, a]))

    let touched = 0
    for (const { accountId, uid } of refs) {
      const message = getMessage(accountId, uid)
      if (!message) continue
      try {
        const result = await categorizeMessage(
          message,
          settings.categories,
          settings.allowUncategorized,
          settings.aiProvider,
          settings.aiModel,
          apiKey,
          settings.summaryLanguage
        )
        setCategory(accountId, uid, result.categoryId)
        setAiSummary(accountId, uid, result.summary)

        const account = accountsById.get(accountId)
        if (account) {
          const action = resolveCategoryAction(result.categoryId, settings)
          await applyCategoryAction(account, uid, action)
        }

        // Broadcast the AI verdict to the cloud so other devices skip it.
        await pushMessageOverlay(message.messageId, {
          categoryId: result.categoryId,
          aiSummary: result.summary,
          categorizedAt: Date.now()
        })

        touched++
        if (touched % NOTIFY_EVERY === 0) broadcast()
      } catch (err) {
        console.error(`[ai] categorize failed accountId=${accountId} uid=${uid}:`, err)
      }
    }
    if (touched > 0) broadcast()
    console.log(`[ai] auto-categorized ${touched}/${refs.length} messages`)
  } finally {
    running = false
  }
}
