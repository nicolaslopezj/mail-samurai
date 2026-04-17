import {
  type Account,
  accountDisplayName,
  type Message,
  type MessageWithBody
} from '@shared/settings'
import { Loader2Icon, RefreshCwIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { buildSanitizedEmailDocument } from '@/lib/sanitize-email'
import { cn } from '@/lib/utils'

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

type Props = { accountScoped?: boolean }

export function InboxPage({ accountScoped = false }: Props): React.JSX.Element {
  const params = useParams<{ accountId?: string }>()
  const accountId = accountScoped ? params.accountId : undefined
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selected, setSelected] = useState<{ accountId: string; uid: number } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const isMountedRef = useRef(true)
  const listRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())

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

  const loadMessages = useCallback(async () => {
    const list = await window.api.messages.list({ accountId, limit: 200 })
    if (!isMountedRef.current) return
    setMessages(list)
  }, [accountId])

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

  const currentAccount = accountId ? accountById.get(accountId) : undefined
  const headerTitle = accountId
    ? `${currentAccount ? accountDisplayName(currentAccount) : 'Inbox'} · Inbox`
    : 'All Inboxes'
  const selectedIndex = useMemo(() => {
    if (!messages || !selected) return -1
    return messages.findIndex((m) => m.accountId === selected.accountId && m.uid === selected.uid)
  }, [messages, selected])

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
    (index: number) => {
      if (!messages || messages.length === 0) return
      const nextMessage = messages[index]
      if (!nextMessage) return
      setSelected({ accountId: nextMessage.accountId, uid: nextMessage.uid })
    },
    [messages]
  )

  const handleListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!messages || messages.length === 0) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const nextIndex = selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, messages.length - 1)
        selectMessageAtIndex(nextIndex)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        const nextIndex = selectedIndex < 0 ? messages.length - 1 : Math.max(selectedIndex - 1, 0)
        selectMessageAtIndex(nextIndex)
        return
      }

      if (event.key === 'Home') {
        event.preventDefault()
        selectMessageAtIndex(0)
        return
      }

      if (event.key === 'End') {
        event.preventDefault()
        selectMessageAtIndex(messages.length - 1)
      }
    },
    [messages, selectMessageAtIndex, selectedIndex]
  )

  useEffect(() => {
    if (!messages || messages.length === 0 || selectedIndex < 0) return
    const selectedMessage = messages[selectedIndex]
    const selectedKey = `${selectedMessage.accountId}:${selectedMessage.uidValidity}:${selectedMessage.uid}`
    itemRefs.current.get(selectedKey)?.scrollIntoView({ block: 'nearest' })
  }, [messages, selectedIndex])

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel id="messages" defaultSize="35%" minSize="20%" maxSize="55%">
        <div className="flex h-full flex-col border-r">
          <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-4">
            <h2 className="truncate text-sm font-semibold">{headerTitle}</h2>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
              aria-label="Refresh"
            >
              {refreshing ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-4" />
              )}
            </button>
          </div>
          <div
            ref={listRef}
            className="flex-1 overflow-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            tabIndex={0}
            role="listbox"
            aria-label="Messages"
            aria-activedescendant={
              selectedIndex >= 0 && messages
                ? `message-${messages[selectedIndex].accountId}-${messages[selectedIndex].uidValidity}-${messages[selectedIndex].uid}`
                : undefined
            }
            onKeyDown={handleListKeyDown}
          >
            {messages === null ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">Loading…</div>
            ) : messages.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No messages in the cache yet. The next sync runs in the background.
              </div>
            ) : (
              <ul className="divide-y">
                {messages.map((m) => {
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
                        onClick={() => {
                          setSelected({ accountId: m.accountId, uid: m.uid })
                          listRef.current?.focus()
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
                        {m.snippet && (
                          <div className="line-clamp-2 w-full text-xs text-muted-foreground">
                            {m.snippet}
                          </div>
                        )}
                        {!accountId && account && (
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {accountDisplayName(account)}
                          </div>
                        )}
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

function MessageReader({
  selected
}: {
  selected: { accountId: string; uid: number } | null
}): React.JSX.Element {
  const [message, setMessage] = useState<MessageWithBody | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadRemoteImages, setLoadRemoteImages] = useState(false)

  // Read the user's preference whenever a different message is opened —
  // gives newly-toggled values a chance to take effect without a full reload.
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    window.api.settings.get().then((s) => {
      if (!cancelled) setLoadRemoteImages(s.loadRemoteImages)
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

  return (
    <article className="flex h-full flex-col">
      <header className="shrink-0 border-b px-6 pt-6 pb-4">
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
  const srcDoc = useMemo(
    () => buildSanitizedEmailDocument(html, attachments, { loadRemoteImages }),
    [html, attachments, loadRemoteImages]
  )

  return (
    <iframe
      title="Email body"
      // No allow-scripts. allow-popups lets <a target="_blank"> open via
      // main's setWindowOpenHandler → shell.openExternal.
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      className="block h-full w-full border-0 bg-transparent"
      style={{ colorScheme: 'light' }}
    />
  )
}
