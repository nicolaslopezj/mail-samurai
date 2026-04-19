import {
  type Account,
  accountDisplayName,
  type Category,
  type Message,
  type MessagesQuery,
  type MessageWithBody,
  type PendingArchiveBatch
} from '@shared/settings'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArchiveXIcon,
  CornerUpLeftIcon,
  CornerUpRightIcon,
  FilterIcon,
  Loader2Icon,
  MailIcon,
  MailOpenIcon,
  RefreshCwIcon,
  ReplyAllIcon,
  SparklesIcon
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ComposeDialog, type ComposeMode } from '@/components/compose-dialog'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { categoryIconComponent } from '@/lib/category-icon'
import { buildSanitizedEmailDocument } from '@/lib/sanitize-email'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

const OTHER_CATEGORY_VALUE = '__other__'

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable
}

type ReaderShortcut = 'archive' | 'unarchive' | 'replyAll' | 'forward' | 'replyAllWithAi'

function formatDate(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  })
}

function senderLabel(message: Message): string {
  if (message.from?.name) return message.from.name
  if (message.from?.address) return message.from.address
  return '(unknown sender)'
}

type Props = {
  accountScoped?: boolean
  /**
   * When set, the page reads `:id` from the URL, filters by that category id,
   * and shows the category name as the header. Without it, every non-archived
   * message is listed (the default Inbox behavior — messages stay in the inbox
   * until archived, regardless of AI categorization).
   */
  categoryScoped?: boolean
  /**
   * The "Others" bucket — messages the AI has categorized but that didn't
   * match any of the user's categories (`categoryId === null` but
   * `categorizedAt !== null`).
   */
  otherScoped?: boolean
  /**
   * The "Archived" bucket — messages whose category has an `archive` action.
   * Combines with `accountScoped` for a per-account archive view.
   */
  archiveScoped?: boolean
}

export function InboxPage({
  accountScoped = false,
  categoryScoped = false,
  otherScoped = false,
  archiveScoped = false
}: Props): React.JSX.Element {
  const params = useParams<{ accountId?: string; id?: string }>()
  const accountId = accountScoped ? params.accountId : undefined
  const categoryId = categoryScoped ? params.id : undefined
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [allowUncategorized, setAllowUncategorized] = useState(true)
  const [selected, setSelected] = useState<{ accountId: string; uid: number } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const isMountedRef = useRef(true)
  const listRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const shouldFocusSelectedRef = useRef(false)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    window.api.accounts.list().then((list) => {
      if (isMountedRef.current) setAccounts(list)
    })
  }, [])

  useEffect(() => {
    window.api.settings.get().then((s) => {
      if (isMountedRef.current) {
        setCategories(s.categories)
        setAllowUncategorized(s.allowUncategorized)
      }
    })
  }, [])

  const loadMessages = useCallback(async () => {
    const query: MessagesQuery = { accountId, limit: 1000 }
    if (categoryId) {
      query.categoryId = categoryId
    } else if (otherScoped) {
      query.other = true
    } else if (archiveScoped) {
      query.archived = true
    } else {
      query.inbox = true
    }
    const list = await window.api.messages.list(query)
    if (!isMountedRef.current) return
    setMessages(list)
  }, [accountId, categoryId, otherScoped, archiveScoped])

  // Refetch when the route changes.
  useEffect(() => {
    setMessages(null)
    setSelected(null)
    loadMessages()
  }, [loadMessages])

  // Live updates from the main process.
  useEffect(() => {
    return window.api.messages.onChanged(() => {
      loadMessages()
    })
  }, [loadMessages])

  const accountById = useMemo(() => {
    const map = new Map<string, Account>()
    for (const a of accounts) map.set(a.id, a)
    return map
  }, [accounts])

  const categoryById = useMemo(() => {
    const map = new Map<string, Category>()
    for (const c of categories) map.set(c.id, c)
    return map
  }, [categories])

  const currentAccount = accountId ? accountById.get(accountId) : undefined
  const currentCategory = categoryId ? categories.find((c) => c.id === categoryId) : undefined
  const accountLabel = currentAccount ? accountDisplayName(currentAccount) : 'Inbox'
  const headerTitle = categoryId
    ? (currentCategory?.name ?? 'Category')
    : otherScoped
      ? allowUncategorized
        ? 'Other'
        : 'Inbox'
      : archiveScoped
        ? accountId
          ? `${accountLabel} · Archive`
          : 'All Archived'
        : accountId
          ? `${accountLabel} · Inbox`
          : 'All Inboxes'
  // Pending archive/unarchive batches live in the main process (DB-backed),
  // so the list and the sidebar both render the "as-if-applied" state via the
  // same query. The renderer only tracks the currently-undoable batch id and
  // its toast so Cmd+Z and the Undo button have something to target.
  const activeBatchRef = useRef<{
    batchId: number
    toastId: string | number
    selectionBefore: { accountId: string; uid: number } | null
  } | null>(null)

  const visibleMessages = useMemo(() => {
    if (!messages) return null
    if (!unreadOnly) return messages
    return messages.filter((m) => !m.seen)
  }, [messages, unreadOnly])
  const selectedIndex = useMemo(() => {
    if (!visibleMessages || !selected) return -1
    return visibleMessages.findIndex(
      (m) => m.accountId === selected.accountId && m.uid === selected.uid
    )
  }, [visibleMessages, selected])

  async function handleRefresh(): Promise<void> {
    setRefreshing(true)
    try {
      await window.api.sync.trigger(accountId)
      await loadMessages()
    } finally {
      if (isMountedRef.current) setRefreshing(false)
    }
  }

  const selectMessageAtIndex = useCallback(
    (index: number, options?: { focus?: boolean }) => {
      if (!visibleMessages || visibleMessages.length === 0) return
      const nextMessage = visibleMessages[index]
      if (!nextMessage) return
      shouldFocusSelectedRef.current = options?.focus ?? false
      setSelected({ accountId: nextMessage.accountId, uid: nextMessage.uid })
    },
    [visibleMessages]
  )

  const undoActiveBatch = useCallback((): void => {
    const active = activeBatchRef.current
    if (!active) return
    activeBatchRef.current = null
    toast.dismiss(active.toastId)
    if (active.selectionBefore) setSelected(active.selectionBefore)
    window.api.messages.cancelPendingBatch(active.batchId).catch((err) => {
      console.error('cancelPendingBatch failed:', err)
    })
  }, [])

  const enqueueArchive = useCallback(
    async (
      mode: 'archive' | 'unarchive',
      entries: { accountId: string; uid: number; subject: string | null }[],
      selectionBefore: { accountId: string; uid: number } | null
    ): Promise<void> => {
      if (entries.length === 0) return

      // Any previous toast becomes stale the moment a new batch lands — the
      // main process auto-commits it on enqueue (single-batch model).
      const previousToast = activeBatchRef.current?.toastId
      activeBatchRef.current = null
      if (previousToast !== undefined) toast.dismiss(previousToast)

      try {
        const entriesArg = entries.map((e) => ({ accountId: e.accountId, uid: e.uid }))
        const call =
          mode === 'archive'
            ? window.api.messages.archive(entriesArg)
            : window.api.messages.unarchive(entriesArg)
        const batch: PendingArchiveBatch = await call

        const label = mode === 'archive' ? 'Archived' : 'Moved to inbox'
        const description =
          entries.length === 1 ? entries[0].subject || '(no subject)' : `${entries.length} messages`
        const duration = Math.max(1000, batch.scheduledAt - Date.now())
        const toastId = toast(label, {
          description,
          duration,
          action: {
            label: 'Undo',
            onClick: () => undoActiveBatch()
          },
          onAutoClose: () => {
            // The main-process timer has fired by now; clear the ref so a
            // later Cmd+Z doesn't fire a no-op cancel for a committed batch.
            if (activeBatchRef.current?.batchId === batch.id) {
              activeBatchRef.current = null
            }
          }
        })

        activeBatchRef.current = { batchId: batch.id, toastId, selectionBefore }
      } catch (err) {
        console.error(`${mode} enqueue failed:`, err)
        toast.error(mode === 'archive' ? 'Archive failed' : 'Unarchive failed')
      }
    },
    [undoActiveBatch]
  )

  const handleArchiveAction = useCallback(
    (
      action: 'archive' | 'unarchive',
      message: Pick<Message, 'accountId' | 'uid' | 'subject' | 'archivedAt'>
    ) => {
      const wasArchived = message.archivedAt !== null
      if (action === 'archive' && wasArchived) return
      if (action === 'unarchive' && !wasArchived) return

      // Move selection to a neighbor before the list refetch drops this
      // message, so the reader pane lands on something instead of going blank.
      const selectionBefore = selected
      if (visibleMessages) {
        const idx = visibleMessages.findIndex(
          (m) => m.accountId === message.accountId && m.uid === message.uid
        )
        if (idx >= 0) {
          const neighbor = visibleMessages[idx + 1] ?? visibleMessages[idx - 1] ?? null
          setSelected(neighbor ? { accountId: neighbor.accountId, uid: neighbor.uid } : null)
        }
      }

      void enqueueArchive(
        action,
        [{ accountId: message.accountId, uid: message.uid, subject: message.subject ?? null }],
        selectionBefore
      )
    },
    [visibleMessages, selected, enqueueArchive]
  )

  const handleArchiveAll = useCallback(() => {
    if (!visibleMessages || visibleMessages.length === 0) return
    const targets = visibleMessages.filter((m) => m.archivedAt === null)
    if (targets.length === 0) return
    const selectionBefore = selected
    setSelected(null)
    void enqueueArchive(
      'archive',
      targets.map((m) => ({ accountId: m.accountId, uid: m.uid, subject: m.subject })),
      selectionBefore
    )
  }, [visibleMessages, selected, enqueueArchive])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== 'z') return
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.shiftKey || event.altKey) return
      if (isEditableTarget(event.target)) return
      if (!activeBatchRef.current) return
      event.preventDefault()
      undoActiveBatch()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undoActiveBatch])

  const handleListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (!visibleMessages || visibleMessages.length === 0) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const nextIndex =
          selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, visibleMessages.length - 1)
        selectMessageAtIndex(nextIndex, { focus: true })
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        const nextIndex =
          selectedIndex < 0 ? visibleMessages.length - 1 : Math.max(selectedIndex - 1, 0)
        selectMessageAtIndex(nextIndex, { focus: true })
        return
      }

      if (event.key === 'Home') {
        event.preventDefault()
        selectMessageAtIndex(0, { focus: true })
        return
      }

      if (event.key === 'End') {
        event.preventDefault()
        selectMessageAtIndex(visibleMessages.length - 1, { focus: true })
        return
      }
    },
    [visibleMessages, selectMessageAtIndex, selectedIndex]
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented) return
      if (event.key.toLowerCase() !== 'e') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return
      if (!visibleMessages || selectedIndex < 0) return
      const current = visibleMessages[selectedIndex]
      if (!current) return
      event.preventDefault()
      handleArchiveAction(event.shiftKey ? 'unarchive' : 'archive', current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [visibleMessages, selectedIndex, handleArchiveAction])

  useEffect(() => {
    if (!visibleMessages || visibleMessages.length === 0 || selectedIndex < 0) return
    const selectedMessage = visibleMessages[selectedIndex]
    const selectedKey = `${selectedMessage.accountId}:${selectedMessage.uidValidity}:${selectedMessage.uid}`
    const selectedItem = itemRefs.current.get(selectedKey)
    if (shouldFocusSelectedRef.current) {
      selectedItem?.focus()
      shouldFocusSelectedRef.current = false
    }
    selectedItem?.scrollIntoView({ block: 'nearest' })
  }, [visibleMessages, selectedIndex])

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel id="messages" defaultSize="35%" minSize="20%" maxSize="55%">
        <div className="flex h-full flex-col border-r">
          <div className="drag flex h-11 shrink-0 items-center justify-between gap-2 border-b px-4">
            <h2 className="truncate text-sm font-semibold">{headerTitle}</h2>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setUnreadOnly((v) => !v)}
                    className={cn(
                      'no-drag rounded p-1 text-muted-foreground hover:bg-muted',
                      unreadOnly && 'bg-muted text-foreground'
                    )}
                    aria-label="Show unread only"
                    aria-pressed={unreadOnly}
                  >
                    <FilterIcon className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {unreadOnly ? 'Showing unread only' : 'Show unread only'}
                </TooltipContent>
              </Tooltip>
              {(categoryScoped || otherScoped) && visibleMessages && visibleMessages.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleArchiveAll}
                      className="no-drag rounded p-1 text-muted-foreground hover:bg-muted"
                      aria-label="Archive all"
                    >
                      <ArchiveXIcon className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Archive all</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="no-drag rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
                    aria-label="Refresh"
                  >
                    {refreshing ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <RefreshCwIcon className="size-4" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>Sync now</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div
            ref={listRef}
            className="flex-1 overflow-auto focus:outline-none"
            tabIndex={0}
            role="listbox"
            aria-label="Messages"
            aria-activedescendant={
              selectedIndex >= 0 && visibleMessages
                ? `message-${visibleMessages[selectedIndex].accountId}-${visibleMessages[selectedIndex].uidValidity}-${visibleMessages[selectedIndex].uid}`
                : undefined
            }
            onKeyDown={handleListKeyDown}
          >
            {visibleMessages === null ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">Loading…</div>
            ) : visibleMessages.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                {unreadOnly
                  ? 'No unread messages.'
                  : categoryId
                    ? 'No messages in this category yet.'
                    : otherScoped
                      ? 'No other messages.'
                      : archiveScoped
                        ? 'No archived messages yet.'
                        : 'Inbox zero. Nice.'}
              </div>
            ) : (
              <ul className="divide-y">
                {visibleMessages.map((m) => {
                  const isSelected = selected?.accountId === m.accountId && selected.uid === m.uid
                  const account = accountById.get(m.accountId)
                  const unread = !m.seen
                  const itemKey = `${m.accountId}:${m.uidValidity}:${m.uid}`
                  return (
                    <li key={itemKey}>
                      <button
                        id={`message-${m.accountId}-${m.uidValidity}-${m.uid}`}
                        ref={(node) => {
                          if (node) {
                            itemRefs.current.set(itemKey, node)
                            return
                          }
                          itemRefs.current.delete(itemKey)
                        }}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={isSelected || selected === null ? 0 : -1}
                        onClick={() => {
                          setSelected({ accountId: m.accountId, uid: m.uid })
                          listRef.current?.focus()
                        }}
                        onKeyDown={(event) => {
                          handleListKeyDown(event)
                        }}
                        className={cn(
                          'relative flex w-full flex-col items-start gap-1 py-3 pr-4 pl-6 text-left transition-colors hover:bg-muted/60 focus:outline-none',
                          isSelected && 'bg-muted'
                        )}
                      >
                        {unread && (
                          <>
                            <span
                              aria-hidden="true"
                              className="absolute top-[18px] left-2 size-2 rounded-full bg-sky-500"
                            />
                            <span className="sr-only">Unread</span>
                          </>
                        )}
                        <div className="flex w-full items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              'truncate text-sm',
                              unread ? 'font-semibold' : 'font-medium'
                            )}
                          >
                            {senderLabel(m)}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatDate(m.date)}
                          </span>
                        </div>
                        <div className={cn('line-clamp-1 w-full text-sm', unread && 'font-medium')}>
                          {m.subject || '(no subject)'}
                        </div>
                        {(m.aiSummary || m.snippet) && (
                          <div
                            className={cn(
                              'w-full whitespace-pre-line text-xs text-muted-foreground',
                              !m.aiSummary && 'line-clamp-2'
                            )}
                          >
                            {m.aiSummary || m.snippet}
                          </div>
                        )}
                        <MessageMeta
                          message={m}
                          category={m.categoryId ? (categoryById.get(m.categoryId) ?? null) : null}
                          allowUncategorized={allowUncategorized}
                          account={!accountId ? (account ?? null) : null}
                        />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="reader" defaultSize="65%" minSize="35%">
        <MessageReader selected={selected} onArchiveAction={handleArchiveAction} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function MessageMeta({
  message,
  category,
  allowUncategorized,
  account
}: {
  message: Message
  category: Category | null
  allowUncategorized: boolean
  account: Account | null
}): React.JSX.Element | null {
  const isAnalyzing = message.categorizedAt === null
  const CategoryIcon = category ? categoryIconComponent(category.icon) : null
  const categoryLabel = isAnalyzing
    ? null
    : category
      ? category.name
      : allowUncategorized && message.categoryId === null
        ? 'Other'
        : null
  const accountLabel = account ? accountDisplayName(account) : null

  if (!isAnalyzing && !categoryLabel && !accountLabel) return null

  return (
    <div className="flex w-full items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
      {isAnalyzing ? (
        <span className="flex items-center gap-1">
          <Loader2Icon className="size-3 animate-spin" />
          <span>Analyzing…</span>
        </span>
      ) : (
        categoryLabel && (
          <span className="flex items-center gap-1">
            {CategoryIcon && <CategoryIcon className="size-3" />}
            <span>{categoryLabel}</span>
          </span>
        )
      )}
      {(isAnalyzing || categoryLabel) && accountLabel && <span aria-hidden="true">·</span>}
      {accountLabel && <span>{accountLabel}</span>}
    </div>
  )
}

function ToolbarButton({
  label,
  hotkey,
  onClick,
  disabled,
  children
}: {
  label: string
  hotkey?: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className="no-drag flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <span>{label}</span>
        {hotkey && <span className="ml-2 text-muted opacity-80">{hotkey}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

function MessageToolbar({
  message,
  onToggleSeen,
  categories,
  allowUncategorized,
  onSetCategory,
  onArchiveToggle,
  onReply,
  onReplyAll,
  onForward,
  onReplyAllWithAi
}: {
  message: MessageWithBody
  onToggleSeen: () => void
  categories: Category[]
  allowUncategorized: boolean
  onSetCategory: (categoryId: string | null) => void
  onArchiveToggle: () => void
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  onReplyAllWithAi: () => void
}): React.JSX.Element {
  const isCategorized = message.categorizedAt !== null
  // Radix Select treats '' as the placeholder state — use it when the message
  // has never been categorized so the trigger falls back to the placeholder
  // text instead of highlighting an item that isn't really selected.
  const selectValue = !isCategorized
    ? ''
    : message.categoryId
      ? message.categoryId
      : allowUncategorized
        ? OTHER_CATEGORY_VALUE
        : ''
  const isArchived = message.archivedAt !== null

  return (
    <div className="drag flex h-11 shrink-0 items-center gap-1 border-b px-3">
      <ToolbarButton
        label={message.seen ? 'Mark as unread' : 'Mark as read'}
        onClick={onToggleSeen}
      >
        {message.seen ? <MailIcon className="size-4" /> : <MailOpenIcon className="size-4" />}
      </ToolbarButton>
      <ToolbarButton
        label={isArchived ? 'Move back to inbox' : 'Archive'}
        hotkey={isArchived ? '⇧E' : 'E'}
        onClick={onArchiveToggle}
      >
        {isArchived ? (
          <ArchiveRestoreIcon className="size-4" />
        ) : (
          <ArchiveIcon className="size-4" />
        )}
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton label="Reply" onClick={onReply}>
        <CornerUpLeftIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Reply All" hotkey="R" onClick={onReplyAll}>
        <ReplyAllIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Forward" hotkey="F" onClick={onForward}>
        <CornerUpRightIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Reply All with AI" hotkey="I" onClick={onReplyAllWithAi}>
        <SparklesIcon className="size-4" />
      </ToolbarButton>
      <Select
        value={selectValue}
        onValueChange={(value) => {
          onSetCategory(value === OTHER_CATEGORY_VALUE ? null : value)
        }}
      >
        <SelectTrigger
          size="sm"
          className="no-drag ml-1 h-7 border-0 bg-transparent px-2 text-xs shadow-none hover:bg-muted data-[state=open]:bg-muted"
          aria-label="Category"
        >
          <SelectValue placeholder="Uncategorized" />
        </SelectTrigger>
        <SelectContent>
          {allowUncategorized && <SelectItem value={OTHER_CATEGORY_VALUE}>Other</SelectItem>}
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function MessageReader({
  selected,
  onArchiveAction
}: {
  selected: { accountId: string; uid: number } | null
  onArchiveAction: (
    action: 'archive' | 'unarchive',
    message: Pick<MessageWithBody, 'accountId' | 'uid' | 'subject' | 'archivedAt'>
  ) => void
}): React.JSX.Element {
  const [message, setMessage] = useState<MessageWithBody | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadRemoteImages, setLoadRemoteImages] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [allowUncategorized, setAllowUncategorized] = useState(true)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [compose, setCompose] = useState<{
    mode: ComposeMode
    aiPromptOpen?: boolean
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.accounts.list().then((list) => {
      if (!cancelled) setAccounts(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Read the user's preference whenever a different message is opened —
  // gives newly-toggled values a chance to take effect without a full reload.
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    window.api.settings.get().then((s) => {
      if (cancelled) return
      setLoadRemoteImages(s.loadRemoteImages)
      setCategories(s.categories)
      setAllowUncategorized(s.allowUncategorized)
    })
    return () => {
      cancelled = true
    }
  }, [selected])

  useEffect(() => {
    if (!selected) {
      setMessage(null)
      return
    }
    let cancelled = false
    setLoading(true)
    window.api.messages
      .get(selected.accountId, selected.uid)
      .then((m) => {
        if (cancelled) return
        setMessage(m)
        setLoading(false)
        if (m && !m.seen) {
          setMessage({ ...m, seen: true })
          window.api.messages
            .setSeen(m.accountId, m.uid, true)
            .catch((err) => console.error('setSeen failed:', err))
        }
      })
      .catch(() => {
        if (cancelled) return
        setMessage(null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  const handleArchiveToggle = useCallback(
    (forceUnarchive = false): void => {
      if (!message) return
      const wasArchived = message.archivedAt !== null
      const action: 'archive' | 'unarchive' =
        forceUnarchive || wasArchived ? 'unarchive' : 'archive'
      onArchiveAction(action, message)
    },
    [message, onArchiveAction]
  )

  const runReaderShortcut = useCallback(
    (shortcut: ReaderShortcut) => {
      if (shortcut === 'replyAll') {
        setCompose({ mode: 'replyAll' })
        return
      }
      if (shortcut === 'forward') {
        setCompose({ mode: 'forward' })
        return
      }
      if (shortcut === 'replyAllWithAi') {
        setCompose({ mode: 'replyAll', aiPromptOpen: true })
        return
      }
      handleArchiveToggle(shortcut === 'unarchive')
    },
    [handleArchiveToggle]
  )

  // R → Reply All, F → Forward, while a message is open and focus isn't in
  // an editable field (the message list listbox counts as non-editable).
  useEffect(() => {
    if (!message || compose) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (isEditableTarget(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'r') {
        event.preventDefault()
        runReaderShortcut('replyAll')
      } else if (key === 'f') {
        event.preventDefault()
        runReaderShortcut('forward')
      } else if (key === 'i') {
        event.preventDefault()
        runReaderShortcut('replyAllWithAi')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [message, compose, runReaderShortcut])

  if (!selected) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a message
      </div>
    )
  }

  if (loading || !message) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  async function handleToggleSeen(): Promise<void> {
    if (!message) return
    const next = !message.seen
    setMessage({ ...message, seen: next })
    try {
      await window.api.messages.setSeen(message.accountId, message.uid, next)
    } catch (err) {
      console.error('setSeen failed:', err)
      setMessage((prev) => (prev ? { ...prev, seen: !next } : prev))
    }
  }

  async function handleSetCategory(categoryId: string | null): Promise<void> {
    if (!message) return
    if (message.categorizedAt !== null && message.categoryId === categoryId) return
    const previousCategoryId = message.categoryId
    const previousCategorizedAt = message.categorizedAt
    setMessage({ ...message, categoryId, categorizedAt: Date.now() })
    try {
      await window.api.messages.setCategory(message.accountId, message.uid, categoryId)
    } catch (err) {
      console.error('setCategory failed:', err)
      setMessage((prev) =>
        prev
          ? { ...prev, categoryId: previousCategoryId, categorizedAt: previousCategorizedAt }
          : prev
      )
    }
  }

  return (
    <article className="flex h-full flex-col">
      <MessageToolbar
        message={message}
        onToggleSeen={handleToggleSeen}
        categories={categories}
        allowUncategorized={allowUncategorized}
        onSetCategory={handleSetCategory}
        onArchiveToggle={handleArchiveToggle}
        onReply={() => setCompose({ mode: 'reply' })}
        onReplyAll={() => setCompose({ mode: 'replyAll' })}
        onForward={() => setCompose({ mode: 'forward' })}
        onReplyAllWithAi={() => setCompose({ mode: 'replyAll', aiPromptOpen: true })}
      />
      <header className="shrink-0 border-b px-6 pt-6 pb-4">
        {message.aiSummary && (
          <div className="mb-4 rounded-lg bg-muted px-4 py-3 text-sm whitespace-pre-line text-muted-foreground">
            {message.aiSummary}
          </div>
        )}
        <h1 className="text-xl font-semibold">{message.subject || '(no subject)'}</h1>
        <div className="mt-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{senderLabel(message)}</span>
          {message.from?.address && message.from.name && (
            <span className="ml-2">&lt;{message.from.address}&gt;</span>
          )}
          <span className="ml-3">{new Date(message.date).toLocaleString()}</span>
        </div>
        {message.to.length > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">
            To:{' '}
            {message.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ')}
          </div>
        )}
      </header>
      {message.bodyHtml ? (
        // Iframe scrolls its own content — give it the full remaining space.
        <div className="min-h-0 flex-1">
          <SandboxedHtmlFrame
            html={message.bodyHtml}
            attachments={message.inlineAttachments}
            loadRemoteImages={loadRemoteImages}
            onShortcut={compose ? null : runReaderShortcut}
          />
        </div>
      ) : message.bodyText ? (
        <div className="flex-1 overflow-auto p-6">
          <pre className="font-sans text-sm whitespace-pre-wrap">{message.bodyText}</pre>
        </div>
      ) : (
        <div className="flex-1 p-6">
          <p className="text-sm text-muted-foreground">(empty message)</p>
        </div>
      )}
      <ComposeDialog
        open={compose !== null}
        onOpenChange={(open) => {
          if (!open) setCompose(null)
        }}
        mode={compose?.mode ?? 'reply'}
        source={message}
        accounts={accounts}
        defaultAccountId={message.accountId}
        initialAiPromptOpen={compose?.aiPromptOpen ?? false}
      />
    </article>
  )
}

/**
 * Render an email HTML body inside a fully isolated sandboxed iframe.
 *
 * Defenses (see also `lib/sanitize-email.ts`):
 *  - `sandbox=""` + explicit `allow-scripts allow-popups
 *    allow-popups-to-escape-sandbox`: unique origin, no forms, no top-nav.
 *    The document's CSP only allows our inline shortcut bridge script. Link
 *    clicks become window-open events, which Electron's
 *    `setWindowOpenHandler` in main routes to `shell.openExternal`.
 *  - `srcdoc`: the document has an opaque origin; it can't touch the parent
 *    `window.api` even if a script somehow slipped through.
 *  - CSP + DOMPurify inside `buildSanitizedEmailDocument` do the rest.
 *
 * The frame fills its container and scrolls internally — sandboxed `srcdoc`
 * iframes have an opaque origin in Chromium, so the parent can't read
 * `contentDocument` to size the frame to its content (the previous attempt
 * left every email at the iframe's default 150 px height).
 */
function SandboxedHtmlFrame({
  html,
  attachments,
  loadRemoteImages,
  onShortcut
}: {
  html: string
  attachments: MessageWithBody['inlineAttachments']
  loadRemoteImages: boolean
  onShortcut?: ((shortcut: ReaderShortcut) => void) | null
}): React.JSX.Element {
  const { resolved: theme } = useTheme()
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const srcDoc = useMemo(
    () => buildSanitizedEmailDocument(html, attachments, { loadRemoteImages, theme }),
    [html, attachments, loadRemoteImages, theme]
  )

  useEffect(() => {
    if (!onShortcut) return
    const shortcutHandler = onShortcut
    function onMessage(event: MessageEvent): void {
      if (event.source !== frameRef.current?.contentWindow) return
      if (
        !event.data ||
        typeof event.data !== 'object' ||
        event.data.type !== 'mail-samurai:email-shortcut' ||
        typeof event.data.key !== 'string'
      ) {
        return
      }
      const key = event.data.key.toLowerCase()
      if (key === 'e') {
        shortcutHandler(event.data.shiftKey ? 'unarchive' : 'archive')
      } else if (key === 'r') {
        shortcutHandler('replyAll')
      } else if (key === 'f') {
        shortcutHandler('forward')
      } else if (key === 'i') {
        shortcutHandler('replyAllWithAi')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onShortcut])

  return (
    <iframe
      ref={frameRef}
      title="Email body"
      // Scripts run in an opaque origin with a CSP nonce that only whitelists
      // our shortcut bridge. Popups still route externally via main.
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      className="block h-full w-full border-0 bg-transparent"
      style={{ colorScheme: theme }}
    />
  )
}
