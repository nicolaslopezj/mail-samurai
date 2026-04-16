import { ArrowLeftIcon, CheckIcon, Loader2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

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
import { AI_PROVIDERS, type AiModel, type AiProvider, type UiSettings } from '@shared/settings'

type LoadState = 'idle' | 'loading' | 'error'

export function SettingsPage(): React.JSX.Element {
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

  useEffect(() => {
    window.api.settings.get().then((current) => {
      setSettings(current)
      setProvider(current.aiProvider ?? '')
      setModel(current.aiModel ?? '')
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
      setModelsError(err instanceof Error ? err.message : String(err))
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
      setSaveError(err instanceof Error ? err.message : String(err))
      setSaveState('error')
    }
  }

  const keyStatus =
    provider && settings?.hasKey[provider] ? 'Stored key on file.' : 'No key stored yet.'
  const canSave = Boolean(provider) && (apiKey.length > 0 || settings?.hasKey[provider as AiProvider])

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b pr-3 pl-20">
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeftIcon />
            Back
          </Link>
        </Button>
        <h1 className="text-sm font-semibold">Settings</h1>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-xl px-6 py-8">
          <section className="space-y-6">
            <div>
              <h2 className="text-base font-semibold">AI provider</h2>
              <p className="text-sm text-muted-foreground">
                Mail Samurai uses this provider to categorize incoming mail.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <Select
                value={provider}
                onValueChange={(v) => setProvider(v as AiProvider)}
              >
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
                      {modelsState === 'loading' && (
                        <Loader2Icon className="animate-spin" />
                      )}
                      {models.length > 0 ? 'Refresh models' : 'Load models'}
                    </Button>
                  </div>
                  <Select
                    value={model}
                    onValueChange={setModel}
                    disabled={models.length === 0}
                  >
                    <SelectTrigger id="model" className="w-full">
                      <SelectValue
                        placeholder={
                          models.length === 0 ? 'Load models to pick one' : 'Select a model'
                        }
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
                  {modelsError && (
                    <p className="text-xs text-destructive">{modelsError}</p>
                  )}
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
          </section>
        </div>
      </div>
    </div>
  )
}
