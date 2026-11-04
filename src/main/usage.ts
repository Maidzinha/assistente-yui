import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { GroqUsage, Settings, UsageInfo } from '@shared/types'
import { getSecret } from './config/store'

/**
 * Créditos e limites dos serviços na nuvem:
 * - ElevenLabs: saldo real do mês, pela API de assinatura.
 * - Groq: limites restantes lidos dos cabeçalhos x-ratelimit-* de cada pedido, e o gasto
 *   estimado do mês somando os tokens e segundos de áudio usados (a Groq não expõe saldo pela API).
 */

const GROQ_HOST = 'api.groq.com'
export const isGroq = (baseUrl: string) => baseUrl.includes(GROQ_HOST)

/** US$ por milhão de tokens (entrada, saída) e por hora de áudio. Confira em groq.com/pricing. */
const GROQ_PRICES: Record<string, [number, number]> = {
  'openai/gpt-oss-20b': [0.075, 0.3],
  'openai/gpt-oss-120b': [0.15, 0.6]
}
const WHISPER_PER_HOUR: Record<string, number> = { 'whisper-large-v3-turbo': 0.04, 'whisper-large-v3': 0.111 }

interface MonthTotals {
  month: string
  promptTokens: number
  completionTokens: number
  audioSeconds: number
  costUsd: number
}

const file = () => join(app.getPath('userData'), 'uso.json')
const thisMonth = () => new Date().toISOString().slice(0, 7)
let totals: MonthTotals | null = null
let saving = Promise.resolve()

const limits: { chat?: Partial<GroqUsage['chat']>; audio?: Partial<GroqUsage['audio']>; at?: number } = {}

async function loadTotals(): Promise<MonthTotals> {
  if (!totals) {
    try {
      totals = JSON.parse(await fs.readFile(file(), 'utf8')) as MonthTotals
    } catch {
      totals = null
    }
  }
  if (!totals || totals.month !== thisMonth()) {
    totals = { month: thisMonth(), promptTokens: 0, completionTokens: 0, audioSeconds: 0, costUsd: 0 }
  }
  return totals
}

function persist() {
  const snapshot = JSON.stringify(totals)
  saving = saving.then(() => fs.writeFile(file(), snapshot, 'utf8')).catch(() => {})
}

const num = (h: Headers, name: string) => {
  const v = h.get(name)
  const n = v === null ? NaN : Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Guarda os limites restantes que a Groq manda em cada resposta. */
export function recordGroqHeaders(kind: 'chat' | 'audio', h: Headers): void {
  const data = {
    requestsLeft: num(h, 'x-ratelimit-remaining-requests'),
    requestsLimit: num(h, 'x-ratelimit-limit-requests'),
    tokensLeft: num(h, 'x-ratelimit-remaining-tokens'),
    tokensLimit: num(h, 'x-ratelimit-limit-tokens')
  }
  if (data.requestsLeft === undefined && data.tokensLeft === undefined) return
  limits[kind] = data
  limits.at = Date.now()
}

export async function addGroqTokens(model: string, prompt: number, completion: number): Promise<void> {
  const t = await loadTotals()
  const [pin, pout] = GROQ_PRICES[model] ?? GROQ_PRICES['openai/gpt-oss-20b']
  t.promptTokens += prompt
  t.completionTokens += completion
  t.costUsd += (prompt * pin + completion * pout) / 1e6
  persist()
}

export async function addGroqAudio(model: string, seconds: number): Promise<void> {
  const t = await loadTotals()
  // A Groq cobra no mínimo 10 segundos por pedido.
  const billed = Math.max(10, seconds)
  t.audioSeconds += billed
  t.costUsd += (billed / 3600) * (WHISPER_PER_HOUR[model] ?? 0.04)
  persist()
}

async function elevenUsage(settings: Settings): Promise<UsageInfo['eleven']> {
  if (settings.tts.provider !== 'elevenlabs') return null
  const key = await getSecret('elevenApiKey')
  if (!key) return { error: 'Falta a chave de API da ElevenLabs.' }
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return { error: `ElevenLabs respondeu ${res.status}.` }
    const s = (await res.json()) as { character_count: number; character_limit: number; next_character_count_reset_unix?: number; tier?: string }
    return {
      used: s.character_count,
      limit: s.character_limit,
      remaining: Math.max(0, s.character_limit - s.character_count),
      resetAt: s.next_character_count_reset_unix ? s.next_character_count_reset_unix * 1000 : undefined,
      plan: s.tier
    }
  } catch {
    return { error: 'Sem conexão com a ElevenLabs.' }
  }
}

export async function getUsage(settings: Settings): Promise<UsageInfo> {
  const usesGroq = (settings.llm.provider === 'openai-compatible' && isGroq(settings.llm.baseUrl)) ||
    (settings.stt.provider === 'openai-compatible' && isGroq(settings.stt.baseUrl))
  const t = await loadTotals()
  return {
    eleven: await elevenUsage(settings),
    groq: usesGroq
      ? {
          chat: limits.chat ?? null,
          audio: limits.audio ?? null,
          updatedAt: limits.at ?? null,
          month: { tokens: t.promptTokens + t.completionTokens, audioMinutes: t.audioSeconds / 60, costUsd: t.costUsd }
        }
      : null
  }
}
