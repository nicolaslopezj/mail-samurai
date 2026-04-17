import {
  ARCHIVE_RETENTION_MS,
  POLL_DEFAULT_MINUTES,
  POLL_MAX_MINUTES,
  POLL_MIN_MINUTES,
  type UiSettings
} from '@shared/settings'
import { CheckIcon, Loader2Icon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ipcErrorMessage } from '@/lib/ipc-error'

const POLL_PRESETS = [
  { label: '5 min', minutes: 5 },
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 }
]

const ARCHIVE_RETENTION_DAYS = Math.round(ARCHIVE_RETENTION_MS / (24 * 60 * 60 * 1000))

type SaveState = 'idle' | 'loading' | 'error'

/** Convert an epoch ms to the YYYY-MM-DD local date string for <input type="date">. */
function msToDateInput(ms: number): string {
  const d = new Date(ms)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Parse a YYYY-MM-DD string as local midnight. Returns NaN if malformed. */
function dateInputToMs(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return Number.NaN
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const d = new Date(year, month, day, 0, 0, 0, 0)
  return d.getTime()
}

function todayMidnightMs(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function SettingsSyncPage(): React.JSX.Element {
  const [settings, setSettings] = useState<UiSettings | null>(null)
  const [syncFromDate, setSyncFromDate] = useState<string>('')
  const [pollMinutes, setPollMinutes] = useState<string>(String(POLL_DEFAULT_MINUTES))
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  const [loadRemoteImages, setLoadRemoteImages] = useState(true)

  useEffect(() => {
    window.api.settings.get().then((current) => {
      setSettings(current)
      setSyncFromDate(msToDateInput(current.syncFromMs))
      setPollMinutes(String(current.pollIntervalMinutes))
      setLoadRemoteImages(current.loadRemoteImages)
    })
  }, [])

  const parsedPoll = Number(pollMinutes)
  const parsedSyncFromMs = useMemo(() => dateInputToMs(syncFromDate), [syncFromDate])
  const todayMidnight = useMemo(() => todayMidnightMs(), [])
  const isSyncFromValid =
    Number.isFinite(parsedSyncFromMs) && parsedSyncFromMs >= 0 && parsedSyncFromMs <= todayMidnight
  const isPollValid =
    Number.isFinite(parsedPoll) && parsedPoll >= POLL_MIN_MINUTES && parsedPoll <= POLL_MAX_MINUTES

  const syncFromChanged = settings && parsedSyncFromMs !== settings.syncFromMs
  const pollChanged = settings && Math.round(parsedPoll) !== settings.pollIntervalMinutes
  const remoteImagesChanged = settings && loadRemoteImages !== settings.loadRemoteImages
  const canSave =
    isSyncFromValid && isPollValid && (syncFromChanged || pollChanged || remoteImagesChanged)

  async function handleSave(): Promise<void> {
    if (!canSave || !settings) return
    setSaveState('loading')
    setSaveError(null)
    try {
      let next = settings
      if (syncFromChanged) {
        next = await window.api.settings.setSyncFromMs(parsedSyncFromMs)
      }
      if (pollChanged) {
        next = await window.api.settings.setPollIntervalMinutes(Math.round(parsedPoll))
      }
      if (remoteImagesChanged) {
        next = await window.api.settings.setLoadRemoteImages(loadRemoteImages)
      }
      setSettings(next)
      setSyncFromDate(msToDateInput(next.syncFromMs))
      setPollMinutes(String(next.pollIntervalMinutes))
      setLoadRemoteImages(next.loadRemoteImages)
      setSaveState('idle')
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (err) {
      setSaveError(ipcErrorMessage(err))
      setSaveState('error')
    }
  }

  const syncFromLabel = settings ? new Date(settings.syncFromMs).toLocaleDateString() : '…'

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-base font-semibold">Sync</h2>
        <p className="text-sm text-muted-foreground">
          Mail Samurai syncs and categorizes emails starting from <strong>{syncFromLabel}</strong>.
          Anything in your inbox from that date on stays cached locally until it's archived upstream
          — archived copies are removed after {ARCHIVE_RETENTION_DAYS} days. The sync runs every{' '}
          <strong>{settings?.pollIntervalMinutes ?? '…'} minutes</strong> in the background.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="syncFrom">Sync from</Label>
        <div className="flex items-center gap-2">
          <Input
            id="syncFrom"
            name="syncFromDate"
            type="date"
            max={msToDateInput(todayMidnight)}
            value={syncFromDate}
            onChange={(e) => setSyncFromDate(e.target.value)}
            className="w-44"
          />
          <span className="text-sm text-muted-foreground">
            Earliest date to sync. Older messages are ignored.
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="poll">Polling interval (minutes)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="poll"
            name="pollIntervalMinutes"
            type="number"
            min={POLL_MIN_MINUTES}
            max={POLL_MAX_MINUTES}
            value={pollMinutes}
            onChange={(e) => setPollMinutes(e.target.value)}
            className="w-32"
          />
          <span className="text-sm text-muted-foreground">
            Between {POLL_MIN_MINUTES} and {POLL_MAX_MINUTES} minutes.
          </span>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {POLL_PRESETS.map((p) => (
            <Button
              key={p.minutes}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPollMinutes(String(p.minutes))}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="loadRemoteImages" className="flex cursor-pointer items-start gap-3">
          <input
            id="loadRemoteImages"
            type="checkbox"
            checked={loadRemoteImages}
            onChange={(e) => setLoadRemoteImages(e.target.checked)}
            className="mt-0.5 size-4 rounded border-input"
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">Load remote images</span>
            <span className="block text-xs font-normal text-muted-foreground">
              When on, the email reader fetches images from the sender's servers. This makes
              messages render the way they were designed but also lets senders track when you open
              the email (a tracking pixel).
            </span>
          </span>
        </Label>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={handleSave} disabled={!canSave || saveState === 'loading'}>
          {saveState === 'loading' && <Loader2Icon className="animate-spin" />}
          Save
        </Button>
        {savedFlash && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckIcon className="size-3.5" />
            Saved
          </span>
        )}
        {saveError && <span className="text-xs text-destructive">{saveError}</span>}
      </div>
    </section>
  )
}
