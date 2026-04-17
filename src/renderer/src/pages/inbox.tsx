import {
  type Account,
  accountDisplayName,
  type Category,
  type Message,
  type MessagesQuery,
  type MessageWithBody
} from '@shared/settings'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
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
      if (isMountedRef.current) setCategories(s.categories)
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
      ? 'Other'
      : archiveScoped
        ? accountId
          ? `${accountLabel} · Archive`
          : 'All Archived'
        : accountId
          ? `${accountLabel} · Inbox`
          : 'All Inboxes'
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

  // Tracks the last archive/unarchive so Cmd+Z (or Ctrl+Z) can flip it back.
  // Single-step undo — consumed after use, not a stack.
  const lastArchiveActionRef = useRef<{
    action: 'archive' | 'unarchive'
    accountId: string
    uid: number
  } | null>(null)

  const handleArchiveAction = useCallback(
    async (action: 'archive' | 'unarchive', message: Message) => {
      const wasArchived = message.archivedAt !== null
      if (action === 'archive' && wasArchived) return
      if (action === 'unarchive' && !wasArchived) return

      // Move selection to a neighbor before the message disappears from the
      // current view, so the reader pane lands on something instead of going
      // blank. Reload from `messages:changed` will rebuild the list shortly.
      if (visibleMessages) {
        const idx = visibleMessages.findIndex(
          (m) => m.accountId === message.accountId && m.uid === message.uid
        )
        if (idx >= 0) {
          const neighbor = visibleMessages[idx + 1] ?? visibleMessages[idx - 1] ?? null
          if (neighbor) {
            setSelected({ accountId: neighbor.accountId, uid: neighbor.uid })
          } else {
            setSelected(null)
          }
        }
      }

      setMessages((prev) =>
        prev
          ? prev.filter((m) => !(m.accountId === message.accountId && m.uid === message.uid))
          : prev
      )

      // Optimistic — toast and undo land instantly. The IPC round-trip
      // happens in the background; on failure we revert and show an error.
      lastArchiveActionRef.current = {
        action,
        accountId: message.accountId,
        uid: message.uid
      }
      const subject = message.subject || '(no subject)'
      const toastId = toast(action === 'archive' ? 'Archived' : 'Moved to inbox', {
        description: subject,
        duration: 8000,
        action: {
          label: 'Undo',
          onClick: () => {
            undoLastArchiveActionRef.current?.()
          }
        }
      })

      try {
        if (action === 'archive') {
          await window.api.messages.archive(message.accountId, message.uid)
        } else {
          await window.api.messages.unarchive(message.accountId, message.uid)
        }
      } catch (err) {
        console.error(`${action} failed:`, err)
        toast.dismiss(toastId)
        toast.error(action === 'archive' ? 'Archive failed' : 'Unarchive failed', {
          description: subject
        })
        if (lastArchiveActionRef.current?.uid === message.uid) {
          lastArchiveActionRef.current = null
        }
        loadMessages()
      }
    },
    [visibleMessages, loadMessages]
  )

  const undoLastArchiveAction = useCallback(async () => {
    const last = lastArchiveActionRef.current
    if (!last) return
    lastArchiveActionRef.current = null
    try {
      if (last.action === 'archive') {
        await window.api.messages.unarchive(last.accountId, last.uid)
      } else {
        await window.api.messages.archive(last.accountId, last.uid)
      }
    } catch (err) {
      console.error(`undo ${last.action} failed:`, err)
      loadMessages()
    }
  }, [loadMessages])

  // Toast's action callback is captured at toast()-call time, so it would
  // see a stale `undoLastArchiveAction`. A ref bridges to the current one.
  const undoLastArchiveActionRef = useRef(undoLastArchiveAction)
  useEffect(() => {
    undoLastArchiveActionRef.current = undoLastArchiveAction
  }, [undoLastArchiveAction])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== 'z') return
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.shiftKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if (!lastArchiveActionRef.current) return
      event.preventDefault()
      undoLastArchiveAction()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undoLastArchiveAction])

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

      if (event.key.toLowerCase() === 'e' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (selectedIndex < 0) return
        const current = visibleMessages[selectedIndex]
        if (!current) return
        event.preventDefault()
        handleArchiveAction(event.shiftKey ? 'unarchive' : 'archive', current)
      }
    },
    [visibleMessages, selectMessageAtIndex, selectedIndex, handleArchiveAction]
  )

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
        <MessageReader selected={selected} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function MessageMeta({
  message,
  category,
  account
}: {
  message: Message
  category: Category | null
  account: Account | null
}): React.JSX.Element | null {
  const isAnalyzing = message.categorizedAt === null
  const CategoryIcon = category ? categoryIconComponent(category.icon) : null
  const categoryLabel = isAnalyzing
    ? null
    : category
      ? category.name
      : message.categoryId === null
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
  onSetCategory,
  onArchiveToggle,
  archiving,
  onReply,
  onReplyAll,
  onForward,
  onReplyAllWithAi
}: {
  message: MessageWithBody
  onToggleSeen: () => void
  categories: Category[]
  onSetCategory: (categoryId: string | null) => void
  onArchiveToggle: () => void
  archiving: boolean
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  onReplyAllWithAi: () => void
}): React.JSX.Element {
  const isCategorized = message.categorizedAt !== null
  // Radix Select treats '' as the placeholder state — use it when the message
  // has never been categorized so the trigger falls back to the placeholder
  // text instead of highlighting an item that isn't really selected.
  const selectValue = !isCategorized ? '' : (message.categoryId ?? OTHER_CATEGORY_VALUE)
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
        disabled={archiving}
      >
        {archiving ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : isArchived ? (
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
          <SelectItem value={OTHER_CATEGORY_VALUE}>Other</SelectItem>
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
  selected
}: {
  selected: { accountId: string; uid: number } | null
}): React.JSX.Element {
  const [message, setMessage] = useState<MessageWithBody | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadRemoteImages, setLoadRemoteImages] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [archiving, setArchiving] = useState(false)
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

  // R → Reply All, F → Forward, while a message is open and focus isn't in
  // an editable field (the message list listbox counts as non-editable).
  useEffect(() => {
    if (!message || compose) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'r') {
        event.preventDefault()
        setCompose({ mode: 'replyAll' })
      } else if (key === 'f') {
        event.preventDefault()
        setCompose({ mode: 'forward' })
      } else if (key === 'i') {
        event.preventDefault()
        setCompose({ mode: 'replyAll', aiPromptOpen: true })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [message, compose])

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

  async function handleArchiveToggle(): Promise<void> {
    if (!message) return
    const previousArchivedAt = message.archivedAt
    const wasArchived = previousArchivedAt !== null
    setMessage({ ...message, archivedAt: wasArchived ? null : Date.now() })
    setArchiving(true)
    try {
      if (wasArchived) {
        await window.api.messages.unarchive(message.accountId, message.uid)
      } else {
        await window.api.messages.archive(message.accountId, message.uid)
      }
    } catch (err) {
      console.error('archive toggle failed:', err)
      setMessage((prev) => (prev ? { ...prev, archivedAt: previousArchivedAt } : prev))
    } finally {
      setArchiving(false)
    }
  }

  return (
    <article className="flex h-full flex-col">
      <MessageToolbar
        message={message}
        onToggleSeen={handleToggleSeen}
        categories={categories}
        onSetCategory={handleSetCategory}
        onArchiveToggle={handleArchiveToggle}
        archiving={archiving}
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
 *  - `sandbox=""` + explicit `allow-popups allow-popups-to-escape-sandbox`:
 *    scripts / same-origin / forms / top-nav all disabled. Link clicks become
 *    window-open events, which Electron's `setWindowOpenHandler` in main
 *    routes to `shell.openExternal` — no in-app navigation, ever.
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
  loadRemoteImages
}: {
  html: string
  attachments: MessageWithBody['inlineAttachments']
  loadRemoteImages: boolean
}): React.JSX.Element {
  const { resolved: theme } = useTheme()
  const srcDoc = useMemo(
    () => buildSanitizedEmailDocument(html, attachments, { loadRemoteImages, theme }),
    [html, attachments, loadRemoteImages, theme]
  )

  return (
    <iframe
      title="Email body"
      // No allow-scripts. allow-popups lets <a target="_blank"> open via
      // main's setWindowOpenHandler → shell.openExternal.
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      className="block h-full w-full border-0 bg-transparent"
      style={{ colorScheme: theme }}
    />
  )
}
