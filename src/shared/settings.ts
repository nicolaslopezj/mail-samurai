export type AiProvider = 'openai' | 'google'

export const AI_PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google Gemini' }
]

export type AiModel = {
  id: string
  label: string
}

export type UiSettings = {
  aiProvider: AiProvider | null
  aiModel: string | null
  hasKey: Record<AiProvider, boolean>
}

export type SettingsApi = {
  get: () => Promise<UiSettings>
  setProvider: (provider: AiProvider, model: string | null) => Promise<UiSettings>
  setApiKey: (provider: AiProvider, apiKey: string) => Promise<UiSettings>
  listModels: (provider: AiProvider, apiKey?: string) => Promise<AiModel[]>
}
