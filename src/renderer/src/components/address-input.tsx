import type { Contact } from '@shared/settings'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type Props = {
  id?: string
  value: string
  onChange: (value: string) => void
  /** Scope the search to one account. Pass `undefined` for cross-account. */
  accountId?: string
  disabled?: boolean
  placeholder?: string
  className?: string
}

/**
 * Split on commas / semicolons / newlines, keeping the separators' positions
 * so we can figure out where the "current" fragment starts in the raw string.
 * Whitespace inside a fragment is preserved (quoted display names can have
 * spaces).
 */
function findFragmentBounds(value: string, caret: number): { start: number; end: number } {
  // Walk backwards from the caret to the previous separator.
  let start = 0
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i]
    if (ch === ',' || ch === ';' || ch === '\n') {
      start = i + 1
      break
    }
  }
  // And forwards to the next separator (or end of string).
  let end = value.length
  for (let i = caret; i < value.length; i++) {
    const ch = value[i]
    if (ch === ',' || ch === ';' || ch === '\n') {
      end = i
      break
    }
  }
  return { start, end }
}

function formatPick(contact: Contact): string {
  return contact.displayName
    ? `${contact.displayName} <${contact.address}>`
    : contact.address
}

/**
 * Freeform comma/semicolon-separated address input with a contact
 * autocomplete popover. Shows matches filtered against the "current
 * fragment" — the text between the last separator and the caret — so the
 * user can type naturally (`"alice, bob<Tab>"`) without thinking about
 * tokens.
 */
export function AddressInput({
  id,
  value,
  onChange,
  accountId,
  disabled,
  placeholder,
  className
}: Props): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [fragment, setFragment] = useState('')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [highlighted, setHighlighted] = useState<string>('')
  const caretRef = useRef<number>(0)

  // Load contacts whenever the fragment (or account scope) changes. Empty
  // fragment still returns the top-N most-recent contacts — handy when the
  // user focuses an empty field to browse the list.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const id = setTimeout(() => {
      window.api.contacts
        .search({ accountId, query: fragment, limit: 8 })
        .then((list) => {
          if (cancelled) return
          setContacts(list)
          // Pre-select the top item so Enter sends it without an arrow press.
          if (list.length > 0) setHighlighted(list[0].address)
        })
        .catch(() => {
          /* ignore */
        })
    }, 80)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [open, fragment, accountId])

  const updateFragment = useCallback((raw: string, caret: number) => {
    caretRef.current = caret
    const { start, end } = findFragmentBounds(raw, caret)
    const frag = raw.slice(start, end).trim()
    setFragment(frag)
  }, [])

  function pick(contact: Contact): void {
    const el = inputRef.current
    const raw = value
    const caret = caretRef.current
    const { start, end } = findFragmentBounds(raw, caret)
    const before = raw.slice(0, start).replace(/\s+$/, '')
    const after = raw.slice(end).replace(/^\s+/, '')
    const formatted = formatPick(contact)
    // `a, b` style separator between tokens; trailing `, ` so the caret
    // lands ready to type the next name.
    const sep = before.length === 0 ? '' : before.endsWith(',') || before.endsWith(';') ? ' ' : ', '
    const tail = after.length === 0 ? ', ' : after.startsWith(',') ? '' : ', '
    const next = `${before}${sep}${formatted}${tail}${after}`
    onChange(next)
    setOpen(false)
    setFragment('')
    // Restore focus + caret right after the inserted chip.
    const newCaret = `${before}${sep}${formatted}${tail}`.length
    requestAnimationFrame(() => {
      el?.focus()
      try {
        el?.setSelectionRange(newCaret, newCaret)
      } catch {
        // selectionStart is only supported on text-like inputs.
      }
    })
  }

  // Keep the input selection in sync with our caret ref so arrow/click moves
  // still pick the right fragment when autocomplete re-fires.
  function handleSelect(event: React.SyntheticEvent<HTMLInputElement>): void {
    const el = event.currentTarget
    updateFragment(el.value, el.selectionStart ?? el.value.length)
  }

  const hasResults = contacts.length > 0
  const displayContacts = useMemo(() => contacts, [contacts])

  return (
    <Popover open={open && hasResults} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          id={id}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className={className}
          onChange={(e) => {
            onChange(e.target.value)
            updateFragment(e.target.value, e.target.selectionStart ?? e.target.value.length)
            if (!open) setOpen(true)
          }}
          onFocus={(e) => {
            updateFragment(e.target.value, e.target.selectionStart ?? e.target.value.length)
            setOpen(true)
          }}
          onBlur={() => {
            // Let click events on the popover fire before closing. The
            // popover's own outside-click handler will close it when the
            // user actually clicks away.
            setTimeout(() => setOpen(false), 120)
          }}
          onSelect={handleSelect}
          onKeyDown={(e) => {
            if (!open || !hasResults) return
            const idx = displayContacts.findIndex((c) => c.address === highlighted)
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              const next = displayContacts[(idx + 1) % displayContacts.length]
              setHighlighted(next.address)
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              const next =
                displayContacts[(idx - 1 + displayContacts.length) % displayContacts.length]
              setHighlighted(next.address)
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              const target = displayContacts.find((c) => c.address === highlighted)
              if (target) {
                e.preventDefault()
                pick(target)
              }
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setOpen(false)
            }
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[min(26rem,90vw)] p-0"
        // Keep focus on the input — the popover is a passive suggestion list.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {displayContacts.map((c) => (
                <CommandItem
                  key={`${c.accountId}:${c.address}`}
                  value={c.address}
                  data-selected={c.address === highlighted ? 'true' : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onSelect={() => pick(c)}
                  className={cn(
                    'flex flex-col items-start gap-0 py-2',
                    c.address === highlighted && 'bg-accent text-accent-foreground'
                  )}
                >
                  <span className="w-full truncate text-sm">
                    {c.displayName || c.address}
                  </span>
                  {c.displayName && (
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {c.address}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
