import type { CloudConfig } from '@shared/settings'
import { CheckIcon, CloudIcon, Loader2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ipcErrorMessage } from '@/lib/ipc-error'

type AsyncState = 'idle' | 'loading' | 'error' | 'success'

export function SettingsCloudPage(): React.JSX.Element {
  const [cloud, setCloud] = useState<CloudConfig | null>(null)
  const [databaseUrl, setDatabaseUrl] = useState('')
  const [authToken, setAuthToken] = useState('')

  const [testState, setTestState] = useState<AsyncState>('idle')
  const [testMessage, setTestMessage] = useState<string | null>(null)

  const [connectState, setConnectState] = useState<AsyncState>('idle')
  const [connectError, setConnectError] = useState<string | null>(null)

  const [syncState, setSyncState] = useState<AsyncState>('idle')

  const [historyState, setHistoryState] = useState<AsyncState>('idle')
  const [historyMessage, setHistoryMessage] = useState<string | null>(null)

  useEffect(() => {
    window.api.cloud.get().then((current) => {
      setCloud(current)
      setDatabaseUrl(current.databaseUrl)
    })
  }, [])

  const canSubmit = databaseUrl.trim().length > 0 && authToken.trim().length > 0

  async function handleTest(): Promise<void> {
    if (!canSubmit) return
    setTestState('loading')
    setTestMessage(null)
    try {
      await window.api.cloud.test({
        databaseUrl: databaseUrl.trim(),
        authToken: authToken.trim()
      })
      setTestState('success')
      setTestMessage('Connection OK')
    } catch (err) {
      setTestState('error')
      setTestMessage(ipcErrorMessage(err))
    }
  }

  async function handleConnect(): Promise<void> {
    if (!canSubmit) return
    setConnectState('loading')
    setConnectError(null)
    try {
      const next = await window.api.cloud.configure({
        databaseUrl: databaseUrl.trim(),
        authToken: authToken.trim()
      })
      setCloud(next)
      setAuthToken('')
      setConnectState('success')
    } catch (err) {
      setConnectError(ipcErrorMessage(err))
      setConnectState('error')
    }
  }

  async function handleSyncNow(): Promise<void> {
    setSyncState('loading')
    try {
      const next = await window.api.cloud.syncNow()
      setCloud(next)
      setSyncState('success')
    } catch {
      setSyncState('error')
    }
  }

  async function handleDisconnect(): Promise<void> {
    const next = await window.api.cloud.disconnect()
    setCloud(next)
    setAuthToken('')
  }

  async function handleListenOnlyChange(enabled: boolean): Promise<void> {
    const next = await window.api.cloud.setListenOnly(enabled)
    setCloud(next)
  }

  async function handlePushHistory(): Promise<void> {
    setHistoryState('loading')
    setHistoryMessage(null)
    try {
      const count = await window.api.cloud.pushHistory()
      setHistoryState('success')
      setHistoryMessage(
        count === 0
          ? 'Nothing to upload — no AI analysis cached locally yet.'
          : `Uploaded ${count} overlay${count === 1 ? '' : 's'}.`
      )
    } catch (err) {
      setHistoryState('error')
      setHistoryMessage(err instanceof Error ? err.message : 'Failed to upload local history.')
    }
  }

  const isConnected = Boolean(cloud?.enabled && cloud.hasToken)
  const lastSyncedLabel = cloud?.lastSyncedAt
    ? new Date(cloud.lastSyncedAt).toLocaleString()
    : 'never'

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-base font-semibold">Cloud sync (Turso)</h2>
        <p className="text-sm text-muted-foreground">
          Mail Samurai can optionally share your categories and AI-generated decisions across
          devices via a Turso (libSQL) database you own. Your email bodies never leave this computer
          — only the category assigned to each message and its short summary, keyed by the email's
          Message-Id. Connecting just pulls what the cloud already has; click{' '}
          <em>Upload local history</em> from the <em>primary</em> device (the one that ran the AI)
          to seed everyone else.
        </p>
      </div>

      {isConnected && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <CloudIcon className="size-4" />
            Connected
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            <code className="font-mono">{cloud?.databaseUrl}</code> · last synced {lastSyncedLabel}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSyncNow}
              disabled={syncState === 'loading'}
            >
              {syncState === 'loading' && <Loader2Icon className="animate-spin" />}
              Sync now
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePushHistory}
              disabled={historyState === 'loading'}
            >
              {historyState === 'loading' && <Loader2Icon className="animate-spin" />}
              Upload local history
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDisconnect}>
              Disconnect
            </Button>
          </div>
          {historyMessage && (
            <p
              className={
                historyState === 'error'
                  ? 'mt-2 text-xs text-destructive'
                  : 'mt-2 text-xs text-muted-foreground'
              }
            >
              {historyMessage}
            </p>
          )}

          <Label
            htmlFor="listenOnly"
            className="mt-4 flex cursor-pointer items-start gap-3 border-t pt-3"
          >
            <input
              id="listenOnly"
              type="checkbox"
              checked={cloud?.listenOnly ?? false}
              onChange={(e) => handleListenOnlyChange(e.target.checked)}
              className="mt-0.5 size-4 rounded border-input"
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">Listen-only device</span>
              <span className="block text-xs font-normal text-muted-foreground">
                Skip the background AI pass on this computer. Incoming emails stay uncategorized
                locally until another device (the primary) categorizes them and the decision syncs
                down. Useful when you don't want this machine to burn API tokens.
              </span>
            </span>
          </Label>
        </div>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="databaseUrl">Database URL</Label>
          <Input
            id="databaseUrl"
            value={databaseUrl}
            onChange={(e) => setDatabaseUrl(e.target.value)}
            placeholder="https://my-db-user.turso.io"
          />
          <p className="text-xs text-muted-foreground">
            Sign in to{' '}
            <a href="https://turso.tech" target="_blank" rel="noreferrer" className="underline">
              turso.tech
            </a>{' '}
            with GitHub, create a database, and copy its URL.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="authToken">Auth token</Label>
          <Input
            id="authToken"
            type="password"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder={isConnected ? 'Leave blank to keep the current token' : 'Bearer token'}
          />
          <p className="text-xs text-muted-foreground">
            Generate one from the Turso dashboard next to your database. The token is encrypted with
            your OS keychain before it touches disk.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleTest} disabled={!canSubmit}>
            {testState === 'loading' && <Loader2Icon className="animate-spin" />}
            Test connection
          </Button>
          <Button onClick={handleConnect} disabled={!canSubmit || connectState === 'loading'}>
            {connectState === 'loading' && <Loader2Icon className="animate-spin" />}
            {isConnected ? 'Update credentials & sync' : 'Connect & sync'}
          </Button>
          {testState === 'success' && (
            <span className="flex items-center gap-1 text-xs text-emerald-600">
              <CheckIcon className="size-3.5" />
              {testMessage}
            </span>
          )}
          {testState === 'error' && testMessage && (
            <span className="text-xs text-destructive">{testMessage}</span>
          )}
          {connectState === 'success' && (
            <span className="flex items-center gap-1 text-xs text-emerald-600">
              <CheckIcon className="size-3.5" />
              Synced
            </span>
          )}
          {connectError && <span className="text-xs text-destructive">{connectError}</span>}
        </div>
      </div>
    </section>
  )
}
