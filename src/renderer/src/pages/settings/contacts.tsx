import type { MacContactsState } from '@shared/settings'
import { CheckIcon, Loader2Icon, RefreshCwIcon, UsersIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ipcErrorMessage } from '@/lib/ipc-error'

type AsyncState = 'idle' | 'loading' | 'error' | 'success'

function formatDate(ms: number | null): string {
  if (ms == null) return 'never'
  return new Date(ms).toLocaleString()
}

export function SettingsContactsPage(): React.JSX.Element {
  const [state, setState] = useState<MacContactsState | null>(null)
  const [action, setAction] = useState<AsyncState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastCount, setLastCount] = useState<number | null>(null)

  useEffect(() => {
    window.api.contacts.macState().then(setState)
  }, [])

  async function refresh(): Promise<void> {
    const next = await window.api.contacts.macState()
    setState(next)
  }

  async function handleConnect(): Promise<void> {
    setAction('loading')
    setError(null)
    try {
      await window.api.contacts.macRequestAccess()
      await refresh()
      setAction('idle')
    } catch (err) {
      setError(ipcErrorMessage(err))
      setAction('error')
    }
  }

  async function handleImport(): Promise<void> {
    setAction('loading')
    setError(null)
    try {
      const result = await window.api.contacts.macImport()
      setLastCount(result.addressesStored)
      await refresh()
      setAction('success')
    } catch (err) {
      setError(ipcErrorMessage(err))
      setAction('error')
    }
  }

  async function handleDisconnect(): Promise<void> {
    setAction('loading')
    try {
      const next = await window.api.contacts.macDisconnect()
      setState(next)
      setLastCount(null)
      setAction('idle')
    } catch (err) {
      setError(ipcErrorMessage(err))
      setAction('error')
    }
  }

  if (!state) {
    return <div className="text-sm text-muted-foreground">Loading…</div>
  }

  if (state.status === 'unsupported') {
    return (
      <section className="space-y-3">
        <Header />
        <p className="text-sm text-muted-foreground">
          macOS Contacts integration is only available on macOS.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <Header />

      <div className="rounded-md border bg-card p-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">macOS Contacts</div>
            <StatusLine state={state} lastCount={lastCount} />
          </div>
          <StatusBadge status={state.status} />
        </div>

        {state.status === 'notDetermined' && (
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Mail Samurai will ask macOS for permission. Once granted, names
              from your address book override whatever shows up in email
              headers — so your wife stays your wife, not &ldquo;Mamá de
              Jerónimo&rdquo; because a random sender labeled her that.
            </p>
            <Button onClick={handleConnect} disabled={action === 'loading'} className="w-fit">
              {action === 'loading' ? <Loader2Icon className="animate-spin" /> : <UsersIcon />}
              Connect Mac Contacts
            </Button>
          </div>
        )}

        {state.status === 'denied' && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-muted-foreground">
              Access was denied. Grant it in{' '}
              <span className="font-medium text-foreground">
                System Settings → Privacy &amp; Security → Contacts
              </span>
              , then come back and import.
            </p>
            <Button variant="outline" onClick={refresh} disabled={action === 'loading'}>
              <RefreshCwIcon /> Check again
            </Button>
          </div>
        )}

        {state.status === 'restricted' && (
          <p className="mt-3 text-xs text-muted-foreground">
            Contacts access is blocked by parental controls or an MDM profile.
          </p>
        )}

        {state.status === 'authorized' && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={handleImport} disabled={action === 'loading'}>
              {action === 'loading' ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <RefreshCwIcon />
              )}
              {state.storedAddresses === 0 ? 'Import now' : 'Refresh import'}
            </Button>
            {state.storedAddresses > 0 && (
              <Button variant="outline" onClick={handleDisconnect} disabled={action === 'loading'}>
                Disconnect
              </Button>
            )}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {action === 'success' && !error && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <CheckIcon className="size-3.5 text-emerald-500" /> Imported.
          </div>
        )}
      </div>
    </section>
  )
}

function Header(): React.JSX.Element {
  return (
    <div>
      <h2 className="text-lg font-semibold">Contacts</h2>
      <p className="text-sm text-muted-foreground">
        Use names from your macOS Contacts app when autocompleting recipients.
      </p>
    </div>
  )
}

function StatusLine({
  state,
  lastCount
}: {
  state: MacContactsState
  lastCount: number | null
}): React.JSX.Element {
  if (state.status !== 'authorized') {
    return (
      <span className="text-xs text-muted-foreground">
        {state.status === 'notDetermined'
          ? 'Not connected yet.'
          : state.status === 'denied'
            ? 'Permission denied by the user.'
            : 'Blocked.'}
      </span>
    )
  }
  const count = lastCount ?? state.storedAddresses
  return (
    <span className="text-xs text-muted-foreground">
      {count} address{count === 1 ? '' : 'es'} imported · last refresh{' '}
      {formatDate(state.lastImportedAt)}
    </span>
  )
}

function StatusBadge({
  status
}: {
  status: MacContactsState['status']
}): React.JSX.Element {
  const label =
    status === 'authorized'
      ? 'Connected'
      : status === 'denied'
        ? 'Denied'
        : status === 'restricted'
          ? 'Restricted'
          : 'Not connected'
  const tone =
    status === 'authorized'
      ? 'bg-emerald-500/15 text-emerald-600'
      : status === 'denied' || status === 'restricted'
        ? 'bg-destructive/15 text-destructive'
        : 'bg-muted text-muted-foreground'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>
  )
}
