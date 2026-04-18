import type { AppInfo, UpdateState } from '@shared/settings'
import {
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GithubIcon,
  Loader2Icon,
  RefreshCwIcon
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ipcErrorMessage } from '@/lib/ipc-error'

function statusLabel(state: UpdateState): string {
  switch (state.status) {
    case 'idle':
      return ''
    case 'dev':
      return state.message ?? 'Updates are only available in packaged builds.'
    case 'checking':
      return 'Checking for updates…'
    case 'not-available':
      return "You're on the latest version."
    case 'available':
      return state.version
        ? `Update available: version ${state.version}. Downloading…`
        : 'Update available. Downloading…'
    case 'downloading': {
      if (typeof state.progress === 'number') {
        return `Downloading update… ${Math.round(state.progress * 100)}%`
      }
      return 'Downloading update…'
    }
    case 'downloaded':
      return state.version
        ? `Version ${state.version} downloaded — it will install when you quit Mail Samurai.`
        : 'Update downloaded — it will install when you quit Mail Samurai.'
    case 'error':
      return state.message ? `Update error: ${state.message}` : 'Update error.'
  }
}

export function SettingsAboutPage(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' })
  const [manualError, setManualError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)

  useEffect(() => {
    window.api.app.info().then(setInfo)
    window.api.app.getUpdateState().then(setUpdateState)
    const off = window.api.app.onUpdateState(setUpdateState)
    return off
  }, [])

  const isBusy =
    updateState.status === 'checking' ||
    updateState.status === 'downloading' ||
    updateState.status === 'available'

  async function handleCheck(): Promise<void> {
    setManualError(null)
    try {
      const next = await window.api.app.checkForUpdates()
      setUpdateState(next)
    } catch (err) {
      setManualError(ipcErrorMessage(err))
    }
  }

  function handleOpen(url: string): void {
    window.api.app.openExternal(url).catch(() => {
      // Ignore — nothing actionable for the user.
    })
  }

  async function handleExportLogs(): Promise<void> {
    setExportStatus(null)
    setExporting(true)
    try {
      const result = await window.api.app.exportLogs()
      if (result.saved) {
        setExportStatus('Logs saved. Attach the file to your GitHub issue.')
      }
    } catch (err) {
      setExportStatus(`Couldn't export logs: ${ipcErrorMessage(err)}`)
    } finally {
      setExporting(false)
    }
  }

  const homepage = info?.homepage ?? 'https://github.com/nicolaslopezj/mail-samurai'
  const status = statusLabel(updateState)

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-base font-semibold">About</h2>
        <p className="text-sm text-muted-foreground">
          Mail Samurai is an open-source email client built by{' '}
          <button
            type="button"
            onClick={() => handleOpen('https://github.com/nicolaslopezj')}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Nicolás López
          </button>
          . Released under the MIT license.
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Source code</div>
        <Button type="button" variant="outline" size="sm" onClick={() => handleOpen(homepage)}>
          <GithubIcon />
          View on GitHub
          <ExternalLinkIcon className="size-3.5 opacity-60" />
        </Button>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Version</div>
        <div className="flex flex-wrap items-center gap-3">
          <code className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs">
            {info?.version ?? '…'}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={handleCheck} disabled={isBusy}>
            {updateState.status === 'checking' ? (
              <Loader2Icon className="animate-spin" />
            ) : updateState.status === 'downloading' || updateState.status === 'available' ? (
              <DownloadIcon />
            ) : (
              <RefreshCwIcon />
            )}
            {updateState.status === 'downloaded' ? 'Check again' : 'Check for updates'}
          </Button>
        </div>
        {status && <p className="text-xs text-muted-foreground">{status}</p>}
        {manualError && <p className="text-xs text-destructive">{manualError}</p>}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Troubleshooting</div>
        <p className="text-xs text-muted-foreground">
          Export a log bundle with version and device info to attach to a GitHub issue.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExportLogs}
          disabled={exporting}
        >
          {exporting ? <Loader2Icon className="animate-spin" /> : <FileTextIcon />}
          Export logs
        </Button>
        {exportStatus && <p className="text-xs text-muted-foreground">{exportStatus}</p>}
      </div>
    </section>
  )
}
