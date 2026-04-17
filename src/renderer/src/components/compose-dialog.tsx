import type { Account, EmailAddress, EmailDraft, MessageWithBody } from '@shared/settings'
import {
  BoldIcon,
  ItalicIcon,
  Link2Icon,
  ListIcon,
  ListOrderedIcon,
  Loader2Icon,
  SendIcon,
  SparklesIcon,
  UnderlineIcon,
  XIcon
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { AddressInput } from '@/components/address-input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { cn } from '@/lib/utils'

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: ComposeMode
  /** The message being replied-to / forwarded. Required except in `new` mode. */
  source?: MessageWithBody | null
  /** Accounts the user can send from. */
  accounts: Account[]
  /** Default account id — usually the one that received the source message. */
  defaultAccountId?: string
  /** Open the AI prompt row on mount (focus the "Draft with AI" input). */
  initialAiPromptOpen?: boolean
}

// ---------------------------------------------------------------------------
// Address parsing
// ---------------------------------------------------------------------------

/**
 * Parse a free-form "Name <addr@example>, other@example" input into
 * EmailAddress entries. Silently drops malformed chunks — the user can see
 * what got parsed by reading the chip list back. Tolerant on purpose.
 */
function parseAddresses(raw: string): EmailAddress[] {
  if (!raw.trim()) return []
  const parts = raw.split(/[,;\n]+/)
  const out: EmailAddress[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/)
    if (match) {
      const name = match[1]?.trim() || null
      const address = match[2].trim()
      if (address.includes('@')) out.push({ name, address })
      continue
    }
    if (trimmed.includes('@')) out.push({ name: null, address: trimmed })
  }
  return out
}

function formatAddresses(list: EmailAddress[]): string {
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ')
}

// ---------------------------------------------------------------------------
// Reply-body builders
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function attributionLine(source: MessageWithBody): string {
  const when = new Date(source.date).toLocaleString()
  const who = source.from
    ? source.from.name
      ? `${source.from.name} <${source.from.address}>`
      : source.from.address
    : '(unknown sender)'
  return `On ${when}, ${who} wrote:`
}

function buildQuotedHtml(source: MessageWithBody): string {
  const attr = escapeHtml(attributionLine(source))
  const body = source.bodyHtml
    ? source.bodyHtml
    : source.bodyText
      ? `<pre style="font-family:inherit;white-space:pre-wrap;margin:0">${escapeHtml(source.bodyText)}</pre>`
      : ''
  return (
    `<br><br><div class="gmail_quote" data-mailsamurai-quote="reply">` +
    `<div dir="ltr" class="gmail_attr">${attr}</div>` +
    `<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${body}</blockquote>` +
    `</div>`
  )
}

/** Text content of `editor` up to (but not including) the quote node. */
function extractTextBeforeQuote(editor: HTMLElement, quote: HTMLElement): string {
  const range = document.createRange()
  range.setStart(editor, 0)
  range.setEndBefore(quote)
  return range.toString().trim()
}

function prefixSubject(subject: string | null, prefix: 'Re' | 'Fwd'): string {
  const s = subject?.trim() || ''
  const re = prefix === 'Re' ? /^re:\s*/i : /^fwd?:\s*/i
  if (re.test(s)) return s
  return s ? `${prefix}: ${s}` : `${prefix}:`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ComposeDialog({
  open,
  onOpenChange,
  mode,
  source,
  accounts,
  defaultAccountId,
  initialAiPromptOpen = false
}: Props): React.JSX.Element {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const [accountId, setAccountId] = useState<string>(defaultAccountId ?? accounts[0]?.id ?? '')
  const [toInput, setToInput] = useState('')
  const [ccInput, setCcInput] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [subject, setSubject] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiPromptOpen, setAiPromptOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const account = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId])

  // Reset + pre-fill whenever the dialog opens for a given source/mode.
  // Radix portal mounts the editor div asynchronously, so fall back to a
  // requestAnimationFrame loop until the ref is attached before writing to it.
  useEffect(() => {
    if (!open) return
    setError(null)
    setSending(false)
    setAccountId(defaultAccountId ?? accounts[0]?.id ?? '')
    setAiPromptOpen(initialAiPromptOpen)
    setAiPrompt('')
    setAiGenerating(false)
    setAiError(null)

    let cancelled = false
    function withEditor(write: (el: HTMLDivElement) => void): void {
      function tick(): void {
        if (cancelled) return
        const el = editorRef.current
        if (!el) {
          requestAnimationFrame(tick)
          return
        }
        write(el)
      }
      tick()
    }

    if (mode === 'new' || !source) {
      setToInput('')
      setCcInput('')
      setShowCc(false)
      setSubject('')
      withEditor((el) => {
        el.innerHTML = ''
      })
      return () => {
        cancelled = true
      }
    }

    const ownEmail = (
      defaultAccountId
        ? accounts.find((a) => a.id === defaultAccountId)?.email
        : source.accountId
          ? accounts.find((a) => a.id === source.accountId)?.email
          : undefined
    )?.toLowerCase()

    if (mode === 'forward') {
      setToInput('')
      setCcInput('')
      setShowCc(false)
      setSubject(prefixSubject(source.subject, 'Fwd'))
      withEditor((el) => {
        el.innerHTML =
          `<br><br><div data-mailsamurai-quote="forward">` +
          `<div>---------- Forwarded message ---------</div>` +
          `<div>From: ${escapeHtml(
            source.from
              ? source.from.name
                ? `${source.from.name} <${source.from.address}>`
                : source.from.address
              : ''
          )}</div>` +
          `<div>Date: ${escapeHtml(new Date(source.date).toLocaleString())}</div>` +
          `<div>Subject: ${escapeHtml(source.subject ?? '')}</div><br>` +
          (source.bodyHtml ??
            (source.bodyText
              ? `<pre style="font-family:inherit;white-space:pre-wrap;margin:0">${escapeHtml(source.bodyText)}</pre>`
              : '')) +
          `</div>`
      })
      return () => {
        cancelled = true
      }
    }

    // reply / replyAll
    const to: EmailAddress[] = source.from ? [source.from] : []
    const cc: EmailAddress[] = []
    if (mode === 'replyAll') {
      for (const addr of [...source.to, ...source.cc]) {
        const a = addr.address.toLowerCase()
        if (a === ownEmail) continue
        if (to.some((t) => t.address.toLowerCase() === a)) continue
        if (cc.some((t) => t.address.toLowerCase() === a)) continue
        cc.push(addr)
      }
    }
    setToInput(formatAddresses(to))
    setCcInput(formatAddresses(cc))
    setShowCc(cc.length > 0)
    setSubject(prefixSubject(source.subject, 'Re'))
    withEditor((el) => {
      el.innerHTML = buildQuotedHtml(source)
      // Caret at the very top so the user can start typing above the quote.
      const range = document.createRange()
      range.setStart(el, 0)
      range.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
    return () => {
      cancelled = true
    }
  }, [open, mode, source, accounts, defaultAccountId, initialAiPromptOpen])

  // Focus the first empty relevant field when the dialog opens.
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => {
      if (aiPromptOpen) {
        const el = document.getElementById('compose-ai-prompt') as HTMLInputElement | null
        el?.focus()
        return
      }
      if (mode === 'new' || mode === 'forward') {
        const el = document.getElementById('compose-to') as HTMLInputElement | null
        el?.focus()
      } else {
        editorRef.current?.focus()
      }
    }, 50)
    return () => clearTimeout(id)
  }, [open, mode, aiPromptOpen])

  function exec(command: string, value?: string): void {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
  }

  function insertLink(): void {
    const url = window.prompt('Link URL', 'https://')
    if (!url) return
    exec('createLink', url)
  }

  /**
   * Convert plain text from the model into tame HTML: blank lines → paragraph
   * breaks, single newlines → `<br>`. Keeps the generated output from reading
   * as one run-on wall when the model writes natural paragraph spacing.
   */
  function textToHtml(text: string): string {
    const paragraphs = text
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    return paragraphs
      .map((p) => `<div>${escapeHtml(p).replace(/\n/g, '<br>')}</div>`)
      .join('<div><br></div>')
  }

  async function handleAiGenerate(): Promise<void> {
    const el = editorRef.current
    if (!el) return
    if (!account) {
      setAiError('Pick an account to send from.')
      return
    }
    setAiGenerating(true)
    setAiError(null)

    // Read only the user-authored portion (above the quote) as context —
    // otherwise the model "sees" the original message twice and tends to
    // parrot it back. Restrict to direct children so nested quotes inside
    // the source body (e.g. forwarding a previous reply) don't get matched.
    const quoteEl = el.querySelector(':scope > [data-mailsamurai-quote]') as HTMLElement | null
    const existingText = quoteEl ? extractTextBeforeQuote(el, quoteEl) : el.innerText.trim()

    try {
      const generated = await window.api.ai.draftReply({
        userPrompt: aiPrompt,
        mode,
        from: { name: account.label?.trim() || null, address: account.email },
        existingBodyText: existingText,
        source:
          source && (mode === 'reply' || mode === 'replyAll' || mode === 'forward')
            ? { accountId: source.accountId, uid: source.uid }
            : null
      })
      const html = textToHtml(generated)
      // Replace the area above the quote with the generated content; preserve
      // the quote intact below. For new/forward with no quote, wipe + insert.
      if (quoteEl) {
        while (el.firstChild && el.firstChild !== quoteEl) {
          el.removeChild(el.firstChild)
        }
        const wrapper = document.createElement('div')
        wrapper.innerHTML = `${html}<div><br></div>`
        while (wrapper.firstChild) {
          el.insertBefore(wrapper.firstChild, quoteEl)
        }
      } else {
        el.innerHTML = html
      }
      setAiPromptOpen(false)
      setAiPrompt('')
    } catch (err) {
      setAiError(ipcErrorMessage(err))
    } finally {
      setAiGenerating(false)
    }
  }

  async function handleSend(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!account) {
      setError('Pick an account to send from.')
      return
    }
    const to = parseAddresses(toInput)
    const cc = parseAddresses(ccInput)
    if (to.length === 0) {
      setError('Add at least one recipient.')
      return
    }
    const html = editorRef.current?.innerHTML ?? ''
    const text = editorRef.current?.innerText ?? ''

    setSending(true)
    setError(null)
    const draft: EmailDraft = {
      accountId: account.id,
      to,
      cc,
      subject,
      bodyText: text,
      bodyHtml: html || null,
      inReplyToMessageId:
        mode === 'reply' || mode === 'replyAll' ? (source?.messageId ?? null) : null
    }
    try {
      await window.api.messages.send(draft)
      onOpenChange(false)
    } catch (err) {
      setError(ipcErrorMessage(err))
      setSending(false)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLFormElement>): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (!sending) event.currentTarget.requestSubmit()
    }
  }

  const titleLabel =
    mode === 'reply'
      ? 'Reply'
      : mode === 'replyAll'
        ? 'Reply All'
        : mode === 'forward'
          ? 'Forward'
          : 'New Message'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(80vh,720px)] max-h-[90vh] flex-col gap-0 p-0 sm:max-w-3xl"
        showCloseButton={false}
      >
        <form onSubmit={handleSend} onKeyDown={handleKeyDown} className="flex h-full flex-col">
          <DialogHeader className="shrink-0 border-b px-5 py-3">
            <DialogTitle className="text-sm font-semibold">{titleLabel}</DialogTitle>
          </DialogHeader>

          <div className="shrink-0 space-y-0 border-b">
            {accounts.length > 1 && (
              <ComposeRow label="From">
                <Select value={accountId} onValueChange={(v) => setAccountId(v)} disabled={sending}>
                  <SelectTrigger
                    size="sm"
                    className="h-7 border-0 bg-transparent px-1 text-sm shadow-none hover:bg-muted"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label?.trim() || a.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ComposeRow>
            )}
            <ComposeRow
              label="To"
              trailing={
                !showCc && (
                  <button
                    type="button"
                    onClick={() => setShowCc(true)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cc
                  </button>
                )
              }
            >
              <AddressInput
                id="compose-to"
                value={toInput}
                onChange={setToInput}
                accountId={accountId || undefined}
                disabled={sending}
                placeholder="name@example.com"
                className="h-7 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
            </ComposeRow>
            {showCc && (
              <ComposeRow label="Cc">
                <AddressInput
                  value={ccInput}
                  onChange={setCcInput}
                  accountId={accountId || undefined}
                  disabled={sending}
                  placeholder="name@example.com"
                  className="h-7 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
                />
              </ComposeRow>
            )}
            <ComposeRow label="Subject">
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={sending}
                placeholder="Subject"
                className="h-7 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
            </ComposeRow>
          </div>

          <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
            <FormatButton label="Bold" hotkey="⌘B" onClick={() => exec('bold')}>
              <BoldIcon className="size-4" />
            </FormatButton>
            <FormatButton label="Italic" hotkey="⌘I" onClick={() => exec('italic')}>
              <ItalicIcon className="size-4" />
            </FormatButton>
            <FormatButton label="Underline" hotkey="⌘U" onClick={() => exec('underline')}>
              <UnderlineIcon className="size-4" />
            </FormatButton>
            <span className="mx-1 h-4 w-px bg-border" />
            <FormatButton label="Bulleted list" onClick={() => exec('insertUnorderedList')}>
              <ListIcon className="size-4" />
            </FormatButton>
            <FormatButton label="Numbered list" onClick={() => exec('insertOrderedList')}>
              <ListOrderedIcon className="size-4" />
            </FormatButton>
            <FormatButton label="Insert link" onClick={insertLink}>
              <Link2Icon className="size-4" />
            </FormatButton>
            <span className="mx-1 h-4 w-px bg-border" />
            <FormatButton
              label="Draft with AI"
              onClick={() => {
                setAiPromptOpen((v) => !v)
                setAiError(null)
              }}
            >
              <SparklesIcon className={cn('size-4', aiPromptOpen && 'text-primary')} />
            </FormatButton>
          </div>

          {aiPromptOpen && (
            <div className="shrink-0 border-b bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2">
                <SparklesIcon className="size-4 shrink-0 text-muted-foreground" />
                <Input
                  id="compose-ai-prompt"
                  autoFocus
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (!aiGenerating) handleAiGenerate()
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setAiPromptOpen(false)
                    }
                  }}
                  disabled={aiGenerating}
                  placeholder={
                    mode === 'new'
                      ? 'Describe the email you want to write…'
                      : 'How should I reply? (e.g. "accept and propose Tuesday at 3pm")'
                  }
                  className="h-8 bg-background"
                />
                <Button type="button" size="sm" onClick={handleAiGenerate} disabled={aiGenerating}>
                  {aiGenerating ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
                  {aiGenerating ? 'Generating…' : 'Generate'}
                </Button>
                <button
                  type="button"
                  onClick={() => setAiPromptOpen(false)}
                  disabled={aiGenerating}
                  aria-label="Close AI prompt"
                  className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <XIcon className="size-4" />
                </button>
              </div>
              {aiError && <div className="mt-1.5 text-xs text-destructive">{aiError}</div>}
            </div>
          )}

          {/* biome-ignore lint/a11y/useSemanticElements: contentEditable rich-text body */}
          <div
            ref={editorRef}
            contentEditable={!sending}
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Message body"
            className={cn(
              'min-h-0 flex-1 overflow-auto px-6 py-4 text-sm leading-6 outline-none',
              sending && 'opacity-60'
            )}
          />

          <div className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3">
            {error ? (
              <div className="truncate text-xs text-destructive" title={error}>
                {error}
              </div>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={sending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={sending || !account}>
                {sending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                {sending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ComposeRow({
  label,
  children,
  trailing
}: {
  label: string
  children: React.ReactNode
  trailing?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b px-4 py-1 last:border-b-0">
      <Label className="w-14 shrink-0 text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="flex-1 min-w-0">{children}</div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  )
}

function FormatButton({
  label,
  hotkey,
  onClick,
  children
}: {
  label: string
  hotkey?: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          // Prevent the editor from losing selection when clicking a format button.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          aria-label={label}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <span>{label}</span>
        {hotkey && <span className="ml-2 opacity-70">{hotkey}</span>}
      </TooltipContent>
    </Tooltip>
  )
}
