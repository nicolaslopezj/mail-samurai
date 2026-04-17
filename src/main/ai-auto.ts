import { BrowserWindow } from 'electron'
import { categorizeMessage } from './ai-categorize'
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
 * and writes the two-line summary. Runs over archived messages too: the user
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
    if (!settings.aiProvider || !settings.aiModel) return
    const apiKey = await getApiKey(settings.aiProvider)
    if (!apiKey) return

    const refs = listUncategorizedRefs(MAX_PER_PASS)
    if (refs.length === 0) return

    let touched = 0
    for (const { accountId, uid } of refs) {
      const message = getMessage(accountId, uid)
      if (!message) continue
      try {
        const result = await categorizeMessage(
          message,
          settings.categories,
          settings.aiProvider,
          settings.aiModel,
          apiKey,
          settings.summaryLanguage
        )
        setCategory(accountId, uid, result.categoryId)
        setAiSummary(accountId, uid, result.summary)
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
