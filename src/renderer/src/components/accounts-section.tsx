import { type Account, IMAP_PROVIDERS } from '@shared/settings'
import { ChevronDownIcon, ChevronUpIcon, MailIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AddAccountDialog } from '@/components/add-account-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function providerLabel(value: Account['provider']): string {
  return IMAP_PROVIDERS.find((p) => p.value === value)?.label ?? value
}

function AccountRow({
  account,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown
}: {
  account: Account
  onChange: (next: Account) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
}): React.JSX.Element {
  const [label, setLabel] = useState<string>(account.label ?? '')

  // Keep local input in sync if the parent updates the account (e.g., after another save).
  useEffect(() => {
    setLabel(account.label ?? '')
  }, [account.label])

  async function commitLabel(): Promise<void> {
    const next = label.trim()
    const current = account.label ?? ''
    if (next === current) return
    const updated = await window.api.accounts.setLabel(account.id, next.length > 0 ? next : null)
    onChange(updated)
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="flex flex-col">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          aria-label={`Move ${account.email} up`}
        >
          <ChevronUpIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label={`Move ${account.email} down`}
        >
          <ChevronDownIcon />
        </Button>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          placeholder={account.email}
          className="h-7 px-2 text-sm font-medium"
          aria-label={`Label for ${account.email}`}
        />
        <p className="truncate px-2 text-xs text-muted-foreground">
          {account.email} · {providerLabel(account.provider)} · {account.host}:{account.port}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRemove}
        aria-label={`Remove ${account.email}`}
      >
        <Trash2Icon />
      </Button>
    </li>
  )
}

export function AccountsSection(): React.JSX.Element {
  const [accounts, setAccounts] = useState<Account[] | null>(null)

  useEffect(() => {
    window.api.accounts.list().then(setAccounts)
  }, [])

  async function handleRemove(id: string): Promise<void> {
    await window.api.accounts.remove(id)
    setAccounts((current) => (current ? current.filter((a) => a.id !== id) : current))
  }

  function handleUpdate(updated: Account): void {
    setAccounts((current) =>
      current ? current.map((a) => (a.id === updated.id ? updated : a)) : current
    )
  }

  async function handleMove(index: number, delta: -1 | 1): Promise<void> {
    if (!accounts) return
    const target = index + delta
    if (target < 0 || target >= accounts.length) return
    const next = accounts.slice()
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    setAccounts(next)
    try {
      const saved = await window.api.accounts.reorder(next.map((a) => a.id))
      setAccounts(saved)
    } catch (err) {
      // Revert on failure.
      setAccounts(accounts)
      console.error('[accounts] reorder failed:', err)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Email accounts</h2>
          <p className="text-sm text-muted-foreground">
            Connected over IMAP. Gmail and iCloud both require an app-specific password.
          </p>
        </div>
        <AddAccountDialog
          trigger={
            <Button size="sm">
              <PlusIcon />
              Add account
            </Button>
          }
          onAdded={(account) => setAccounts((current) => [...(current ?? []), account])}
        />
      </div>

      {accounts === null ? (
        <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-md border border-dashed px-4 py-8 text-center">
          <MailIcon className="mx-auto mb-2 size-5 text-muted-foreground" />
          <p className="text-sm font-medium">No accounts yet</p>
          <p className="text-xs text-muted-foreground">
            Add your first account to start fetching mail.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-md border">
          {accounts.map((account, index) => (
            <AccountRow
              key={account.id}
              account={account}
              onChange={handleUpdate}
              onRemove={() => handleRemove(account.id)}
              onMoveUp={() => handleMove(index, -1)}
              onMoveDown={() => handleMove(index, 1)}
              canMoveUp={index > 0}
              canMoveDown={index < accounts.length - 1}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
