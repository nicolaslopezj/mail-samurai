import {
  POLL_DEFAULT_MINUTES,
  POLL_MAX_MINUTES,
  POLL_MIN_MINUTES,
  RETENTION_DEFAULT_HOURS,
  RETENTION_MAX_HOURS,
  RETENTION_MIN_HOURS,
  type UiSettings
} from '@shared/settings'
import { CheckIcon, Loader2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ipcErrorMessage } from '@/lib/ipc-error'

const RETENTION_PRESETS = [
  { label: '24 h', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 }
]

const POLL_PRESETS = [
  { label: '5 min', minutes: 5 },
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 }
]

type SaveState = 'idle' | 'loading' | 'error'

export function SettingsSyncPage(): React.JSX.Element {
  const [settings, setSettings] = useState<UiSettings | null>(null)
  const [hours, setHours] = useState<string>(String(RETENTION_DEFAULT_HOURS))
  const [pollMinutes, setPollMinutes] = useState<string>(String(POLL_DEFAULT_MINUTES))
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  const [loadRemoteImages, setLoadRemoteImages] = useState(true)

  useEffect(() => {
    window.api.settings.get().then((current) => {
      setSettings(current)
      setHours(String(current.retentionHours))
      setPollMinutes(String(current.pollIntervalMinutes))
      setLoadRemoteImages(current.loadRemoteImages)
    })
  }, [])

  const parsedHours = Number(hours)
  const parsedPoll = Number(pollMinutes)
  const isHoursValid =
    Number.isFinite(parsedHours) &&
    parsedHours >= RETENTION_MIN_HOURS &&
    parsedHours <= RETENTION_MAX_HOURS
  const isPollValid =
    Number.isFinite(parsedPoll) && parsedPoll >= POLL_MIN_MINUTES && parsedPoll <= POLL_MAX_MINUTES

  const hoursChanged = settings && Math.round(parsedHours) !== settings.retentionHours
  const pollChanged = settings && Math.round(parsedPoll) !== settings.pollIntervalMinutes
  const remoteImagesChanged = settings && loadRemoteImages !== settings.loadRemoteImages
  const canSave =
    isHoursValid && isPollValid && (hoursChanged || pollChanged || remoteImagesChanged)

  async function handleSave(): Promise<void> {
    if (!canSave || !settings) return
    setSaveState('loading')
    setSaveError(null)
    try {
      let next = settings
      if (hoursChanged) {
        next = await window.api.settings.setRetentionHours(Math.round(parsedHours))
      }
      if (pollChanged) {
        next = await window.api.settings.setPollIntervalMinutes(Math.round(parsedPoll))
      }
      if (remoteImagesChanged) {
        next = await window.api.settings.setLoadRemoteImages(loadRemoteImages)
      }
      setSettings(next)
      setHours(String(next.retentionHours))
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

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-base font-semibold">Sync</h2>
        <p className="text-sm text-muted-foreground">
          Mail Samurai keeps the last <strong>{settings?.retentionHours ?? '…'} hours</strong> of
          your inbox cached locally and removes anything older. The sync runs every{' '}
          <strong>{settings?.pollIntervalMinutes ?? '…'} minutes</strong> in the background.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="retention">Retention window (hours)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="retention"
            name="retentionHours"
            type="number"
            min={RETENTION_MIN_HOURS}
            max={RETENTION_MAX_HOURS}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="w-32"
          />
          <span className="text-sm text-muted-foreground">
            Between {RETENTION_MIN_HOURS} and {RETENTION_MAX_HOURS} hours.
          </span>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {RETENTION_PRESETS.map((p) => (
            <Button
              key={p.hours}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setHours(String(p.hours))}
            >
              {p.label}
            </Button>
          ))}
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
