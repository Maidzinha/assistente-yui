import type { Settings } from '@shared/types'
import { getSecret } from '../config/store'
import { OllamaAdapter } from './ollama'
import { OpenAiCompatibleAdapter } from './openaiCompatible'
import type { LlmAdapter } from './types'

let current: { key: string; adapter: LlmAdapter } | null = null

export async function getLlm(settings: Settings): Promise<LlmAdapter> {
  const apiKey = await getSecret('llmApiKey')
  const key = JSON.stringify(settings.llm) + (apiKey ? '+key' : '')
  if (current?.key === key) return current.adapter
  const { provider, baseUrl, model, temperature } = settings.llm
  const adapter =
    provider === 'openai-compatible'
      ? new OpenAiCompatibleAdapter({ baseUrl, model, temperature, apiKey })
      : new OllamaAdapter({ baseUrl, model, temperature })
  current = { key, adapter }
  return adapter
}
