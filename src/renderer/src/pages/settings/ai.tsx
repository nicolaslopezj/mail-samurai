import {
  AI_PROVIDERS,
  AI_REPLY_PREFERENCES_DEFAULT,
  type AiModel,
  type AiProvider,
  type AiReplyPreferences,
  SUMMARY_LANGUAGES,
  type SummaryLanguage,
  type UiSettings
} from '@shared/settings'
import { CheckIcon, Loader2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ipcErrorMessage } from '@/lib/ipc-error'

type LoadState = 'idle' | 'loading' | 'error'

export function SettingsAiPage(): React.JSX.Element {
  const [settings, setSettings] = useState<UiSettings | null>(null)
  const [provider, setProvider] = useState<AiProvider | ''>('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [models, setModels] = useState<AiModel[]>([])
  const [modelsState, setModelsState] = useState<LoadState>('idle')
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<LoadState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [replyPrefs, setReplyPrefs] = useState<AiReplyPreferences>(AI_REPLY_PREFERENCES_DEFAULT)
  const [prefsSaveState, setPrefsSaveState] = useState<LoadState>('idle')
  const [prefsSavedFlash, setPrefsSavedFlash] = useState(false)
  const [prefsError, setPrefsError] = useState<string | null>(null)

  useEffect(() => {
    window.api.settings.get().then((current) => {
      setSettings(current)
      setProvider(current.aiProvider ?? '')
      setModel(current.aiModel ?? '')
      setReplyPrefs(current.aiReplyPreferences ?? AI_REPLY_PREFERENCES_DEFAULT)
    })
  }, [])

  // When provider changes, reset the form state.
  useEffect(() => {
    setApiKey('')
    setModels([])
    setModelsState('idle')
    setModelsError(null)
    if (settings && provider) {
      setModel(settings.aiProvider === provider ? (settings.aiModel ?? '') : '')
    } else {
      setModel('')
    }
  }, [provider, settings])

  async function handleLoadModels(): Promise<void> {
    if (!provider) return
    const usingStoredKey = !apiKey
    if (usingStoredKey && !settings?.hasKey[provider]) {
      setModelsError('Enter an API key first.')
      setModelsState('error')
      return
    }
    setModelsState('loading')
    setModelsError(null)
    try {
      const list = await window.api.settings.listModels(provider, apiKey || undefined)
      setModels(list)
      setModelsState('idle')
    } catch (err) {
      setModelsError(ipcErrorMessage(err))
      setModelsState('error')
    }
  }

  async function handleSave(): Promise<void> {
    if (!provider) return
    setSaveState('loading')
    setSaveError(null)
    try {
      let next = settings
      if (apiKey) {
        next = await window.api.settings.setApiKey(provider, apiKey)
      }
      next = await window.api.settings.setProvider(provider, model || null)
      setSettings(next)
      setApiKey('')
      setSaveState('idle')
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (err) {
      setSaveError(ipcErrorMessage(err))
      setSaveState('error')
    }
  }

  async function handleSaveReplyPrefs(): Promise<void> {
    setPrefsSaveState('loading')
    setPrefsError(null)
    try {
      const next = await window.api.settings.setAiReplyPreferences(replyPrefs)
      setSettings(next)
      setReplyPrefs(next.aiReplyPreferences)
      setPrefsSaveState('idle')
      setPrefsSavedFlash(true)
      setTimeout(() => setPrefsSavedFlash(false), 1500)
    } catch (err) {
      setPrefsError(ipcErrorMessage(err))
      setPrefsSaveState('error')
    }
  }

  async function handleSummaryLanguageChange(value: SummaryLanguage): Promise<void> {
    // Save inline — picking a language is a single-field change, no Save button
    // needed. Optimistically update local state so the dropdown feels instant.
    setSettings((prev) => (prev ? { ...prev, summaryLanguage: value } : prev))
    try {
      const next = await window.api.settings.setSummaryLanguage(value)
      setSettings(next)
    } catch (err) {
      setSaveError(ipcErrorMessage(err))
    }
  }

  const keyStatus =
    provider && settings?.hasKey[provider] ? 'Stored key on file.' : 'No key stored yet.'
  const canSave =
    Boolean(provider) && (apiKey.length > 0 || settings?.hasKey[provider as AiProvider])

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">AI provider</h2>
        <p className="text-sm text-muted-foreground">
          Mail Samurai uses this provider to categorize incoming mail.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="provider">Provider</Label>
        <Select value={provider} onValueChange={(v) => setProvider(v as AiProvider)}>
          <SelectTrigger id="provider" className="w-full">
            <SelectValue placeholder="Select a provider" />
          </SelectTrigger>
          <SelectContent>
            {AI_PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {provider && (
        <>
          <div className="space-y-2">
            <Label htmlFor="apiKey">API key</Label>
            <Input
              id="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={settings?.hasKey[provider] ? '•••••••••••• (stored)' : 'Paste key'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{keyStatus}</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="model">Model</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLoadModels}
                disabled={modelsState === 'loading'}
              >
                {modelsState === 'loading' && <Loader2Icon className="animate-spin" />}
                {models.length > 0 ? 'Refresh models' : 'Load models'}
              </Button>
            </div>
            <Select value={model} onValueChange={setModel} disabled={models.length === 0}>
              <SelectTrigger id="model" className="w-full">
                <SelectValue
                  placeholder={models.length === 0 ? 'Load models to pick one' : 'Select a model'}
                />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
                {model && !models.some((m) => m.id === model) && (
                  <SelectItem value={model}>{model} (saved)</SelectItem>
                )}
              </SelectContent>
            </Select>
            {modelsError && <p className="text-xs text-destructive">{modelsError}</p>}
          </div>
        </>
      )}

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

      <div className="space-y-4 border-t pt-6">
        <div>
          <h3 className="text-sm font-semibold">Reply instructions</h3>
          <p className="text-sm text-muted-foreground">
            Custom instructions the AI follows every time you use "Draft with AI" in the
            compose window. Tone, signature, language, length — anything goes.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reply-instructions" className="sr-only">
            Custom instructions
          </Label>
          <Textarea
            id="reply-instructions"
            placeholder={
              'e.g. "Write in Spanish, use tú not usted. Never use emojis. Keep replies under 4 sentences. Sign as Nicolás."'
            }
            value={replyPrefs.instructions}
            onChange={(e) => setReplyPrefs((p) => ({ ...p, instructions: e.target.value }))}
            disabled={prefsSaveState === 'loading'}
            rows={8}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleSaveReplyPrefs} disabled={prefsSaveState === 'loading'}>
            {prefsSaveState === 'loading' && <Loader2Icon className="animate-spin" />}
            Save instructions
          </Button>
          {prefsSavedFlash && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckIcon className="size-3.5" />
              Saved
            </span>
          )}
          {prefsError && <span className="text-xs text-destructive">{prefsError}</span>}
        </div>
      </div>

      <div className="space-y-2 border-t pt-6">
        <div>
          <h3 className="text-sm font-semibold">Summary language</h3>
          <p className="text-sm text-muted-foreground">
            Language used for the one-sentence summary shown in the message list. Pick one to force
            every summary into that language, or leave it on auto to match the email's original
            language.
          </p>
        </div>
        <Select
          value={settings?.summaryLanguage ?? 'auto'}
          onValueChange={(v) => handleSummaryLanguageChange(v as SummaryLanguage)}
          disabled={!settings}
        >
          <SelectTrigger id="summaryLanguage" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUMMARY_LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  )
}
