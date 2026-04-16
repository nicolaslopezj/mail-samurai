import type { AiModel, AiProvider } from '../shared/settings'

async function listOpenAiModels(apiKey: string): Promise<AiModel[]> {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenAI /v1/models ${res.status}: ${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as { data: { id: string }[] }
  return json.data
    .filter((m) => /^(gpt-|o\d|chatgpt)/i.test(m.id))
    .map((m) => ({ id: m.id, label: m.id }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

async function listGoogleModels(apiKey: string): Promise<AiModel[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google models ${res.status}: ${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    models: {
      name: string
      displayName?: string
      supportedGenerationMethods?: string[]
    }[]
  }
  return json.models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => {
      const id = m.name.replace(/^models\//, '')
      return { id, label: m.displayName ? `${m.displayName} (${id})` : id }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

export async function listModels(provider: AiProvider, apiKey: string): Promise<AiModel[]> {
  if (!apiKey) throw new Error('API key is required to list models.')
  switch (provider) {
    case 'openai':
      return listOpenAiModels(apiKey)
    case 'google':
      return listGoogleModels(apiKey)
  }
}
