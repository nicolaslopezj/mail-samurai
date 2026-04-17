import { exec } from 'node:child_process'
import type { Account, CategoryAction, Message, UiSettings } from '../shared/settings'
import { archiveMessage, deleteMessageImap, moveMessageToFolder, setMessageSeen } from './imap-sync'
import { deleteMessage, getMessage, setArchivedLocal, setSeenLocal } from './messages-store'

/**
 * Resolve the action configured for a freshly categorized message. Returns
 * the matching category's action, or the user's `uncategorizedAction` when
 * no category matched.
 */
export function resolveCategoryAction(
  categoryId: string | null,
  settings: UiSettings
): CategoryAction {
  if (!categoryId) return settings.uncategorizedAction
  const match = settings.categories.find((c) => c.id === categoryId)
  return match?.action ?? { kind: 'none' }
}

/**
 * Execute the post-categorization action for a single message. Updates the
 * local cache optimistically and fires the IMAP side-effect in the background
 * (mirroring the manual `messages:archive` / `messages:setSeen` handlers).
 * Errors are logged but never thrown — the categorization itself has already
 * been persisted, and we don't want a flaky IMAP move to poison the AI pass.
 */
export async function applyCategoryAction(
  account: Account,
  uid: number,
  action: CategoryAction
): Promise<void> {
  switch (action.kind) {
    case 'none':
      return

    case 'markRead': {
      setSeenLocal(account.id, uid, true)
      setMessageSeen(account, uid, true).catch((err) =>
        console.error(`[action] markRead uid=${uid} failed:`, err)
      )
      return
    }

    case 'archive': {
      setArchivedLocal(account.id, uid, Date.now())
      archiveMessage(account, uid).catch((err) =>
        console.error(`[action] archive uid=${uid} failed:`, err)
      )
      return
    }

    case 'delete': {
      setArchivedLocal(account.id, uid, Date.now())
      try {
        await deleteMessageImap(account, uid)
        // The message is gone upstream; drop the local row so it isn't
        // re-processed or shown in Archived.
        deleteMessage(account.id, uid)
      } catch (err) {
        console.error(`[action] delete uid=${uid} failed:`, err)
      }
      return
    }

    case 'moveToFolder': {
      // Moving out of INBOX looks like archiving to our reconcile logic;
      // stamp archived locally so the UI reflects it immediately.
      setArchivedLocal(account.id, uid, Date.now())
      moveMessageToFolder(account, uid, action.folder).catch((err) =>
        console.error(`[action] moveToFolder(${action.folder}) uid=${uid} failed:`, err)
      )
      return
    }

    case 'runCommand': {
      const message = getMessage(account.id, uid)
      runUserCommand(action.command, account, uid, message)
      return
    }
  }
}

/**
 * Fire the user-supplied shell command with message metadata exposed via
 * environment variables. Fire-and-forget: we don't wait for it to finish and
 * we don't surface its output to the UI. stdout/stderr are logged so the user
 * can tail the app log if they need to debug.
 *
 * Passed via a shell (`exec`) on purpose — users legitimately want pipes,
 * redirection, and `&&` chains in the Settings field. This is running on the
 * user's own machine with their own command, so the risk is the same as a
 * crontab entry they wrote themselves.
 */
function runUserCommand(
  command: string,
  account: Account,
  uid: number,
  message: Message | null
): void {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MAIL_ACCOUNT_ID: account.id,
    MAIL_ACCOUNT_EMAIL: account.email,
    MAIL_UID: String(uid),
    MAIL_SUBJECT: message?.subject ?? '',
    MAIL_FROM: message?.from?.address ?? '',
    MAIL_FROM_NAME: message?.from?.name ?? '',
    MAIL_CATEGORY_ID: message?.categoryId ?? '',
    MAIL_DATE_MS: message ? String(message.date) : '',
    MAIL_MESSAGE_ID: message?.messageId ?? '',
    MAIL_SNIPPET: message?.snippet ?? ''
  }
  exec(command, { env, timeout: 60_000 }, (err, stdout, stderr) => {
    if (err) {
      console.error(`[action] runCommand uid=${uid} failed:`, err.message)
    }
    if (stdout.trim()) console.log(`[action] runCommand uid=${uid} stdout: ${stdout.trim()}`)
    if (stderr.trim()) console.error(`[action] runCommand uid=${uid} stderr: ${stderr.trim()}`)
  })
}
