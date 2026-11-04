// Tipos compartilhados entre o processo principal, o preload e a interface.

export type MessageSource = 'text' | 'voice'

export type ActionStatus =
  | 'awaiting-confirmation'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'denied'

export interface ActionRecord {
  id: string
  name: string
  label: string
  summary: string
  requiresConfirmation: boolean
  status: ActionStatus
  result?: string
  error?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  source: MessageSource
  createdAt: number
  actions?: ActionRecord[]
  error?: string
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
  lastSource: MessageSource
  messageCount: number
}

export type LlmProviderId = 'ollama' | 'openai-compatible'
export type SttProviderId = 'local-whisper' | 'whisper-cpp' | 'openai-compatible' | 'none'
export type TtsProviderId = 'custom-voice' | 'elevenlabs' | 'fish-audio' | 'system' | 'piper' | 'openai-compatible' | 'none'

/** Voz personalizada: XTTS v2 com latentes da voz + (opcional) timbre RVC por cima. */
export interface CustomVoiceSettings {
  name: string
  xttsPython: string
  xttsModelDir: string
  xttsLatents: string
  xttsDevice: 'cuda' | 'cpu' | 'on-demand'
  rvcEnabled: boolean
  rvcPython: string
  rvcDir: string
  rvcModel: string
  rvcIndex: string
  rvcPitch: number
  /** rmvpe é mais preciso no tom; pm é mais rápido. */
  rvcF0Method: 'rmvpe' | 'pm'
  /** Quanto o índice puxa para o timbre treinado (0 a 1). */
  rvcIndexRate: number
  /** Protege consoantes e respiração (0 a 0,5). */
  rvcProtect: number
  rvcDevice: 'cuda' | 'cpu'
}
export type VoiceLanguage = 'pt-BR' | 'en-US'

export interface Settings {
  llm: {
    provider: LlmProviderId
    baseUrl: string
    model: string
    temperature: number
  }
  stt: {
    provider: SttProviderId
    baseUrl: string
    model: string
    /** faster-whisper local, iniciado pelo próprio app. */
    whisperPython: string
    /** tiny, base, small, medium, large-v3, turbo… */
    whisperModel: string
    whisperDevice: 'cpu' | 'cuda'
  }
  tts: {
    provider: TtsProviderId
    /** Nome da voz do Windows (provedor "system") ou da voz do servidor. */
    voice: string
    piperPath: string
    piperModel: string
    baseUrl: string
    model: string
    rate: number
    custom: CustomVoiceSettings
    /** Fish Audio (nuvem): código da voz clonada e modelo de síntese. A chave fica em ttsApiKey. */
    fishVoiceId: string
    fishModel: string
    /** low responde mais rápido; normal tem um pouco mais de qualidade. */
    fishLatency: 'low' | 'normal' | 'balanced'
    /** ElevenLabs (nuvem): código da voz clonada e modelo. A chave fica em elevenApiKey. */
    elevenVoiceId: string
    elevenModel: string
    /** 0 a 1: mais baixo = mais emoção; mais alto = mais constante. */
    elevenStability: number
    /** 0 a 1: quanto puxa para o timbre da voz original. */
    elevenSimilarity: number
    /** Jeito de falar (só nos modelos v3 e v4, que entendem marcações de emoção). */
    elevenTone: 'none' | 'warm' | 'cute'
  }
  voice: {
    language: VoiceLanguage
    spokenReplies: boolean
    /** Também fala as respostas de mensagens digitadas. */
    speakTextReplies: boolean
    autoStopOnSilence: boolean
    continuousConversation: boolean
  }
  avatar: {
    /** 3d mostra o modelo .vrm (se houver); 2d mostra o desenho com as bocas. */
    mode: '2d' | '3d'
    /** Nome do modelo importado (o arquivo fica copiado na pasta do app). */
    vrmName: string
  }
}

export interface RateLimits {
  requestsLeft?: number
  requestsLimit?: number
  tokensLeft?: number
  tokensLimit?: number
}

export interface GroqUsage {
  /** Limites restantes do último pedido de conversa (pedidos por dia, tokens por minuto). */
  chat: RateLimits | null
  audio: RateLimits | null
  updatedAt: number | null
  /** Somado pelo app neste mês, com o preço de tabela. */
  month: { tokens: number; audioMinutes: number; costUsd: number }
}

export interface UsageInfo {
  eleven: { used?: number; limit?: number; remaining?: number; resetAt?: number; plan?: string; error?: string } | null
  groq: GroqUsage | null
}

/** Algo que a Yui lembra sobre o usuário entre conversas. */
export interface MemoryItem {
  id: string
  text: string
  createdAt: number
}

export type SecretKey = 'llmApiKey' | 'sttApiKey' | 'ttsApiKey' | 'elevenApiKey'

export interface SecretsInfo {
  llmApiKey: boolean
  sttApiKey: boolean
  ttsApiKey: boolean
  elevenApiKey: boolean
  encryptionAvailable: boolean
}

export interface ProviderStatus {
  ok: boolean
  message: string
  /** Passos para configurar quando o provedor não está disponível. */
  hint?: string[]
}

export interface ProvidersStatus {
  llm: ProviderStatus
  stt: ProviderStatus
  tts: ProviderStatus
}

export type ChatEvent =
  | { type: 'delta'; turnId: string; text: string }
  | { type: 'action'; turnId: string; action: ActionRecord }
  | { type: 'done'; turnId: string; conversationId: string; message: ChatMessage }
  | { type: 'error'; turnId: string; conversationId: string; message: ChatMessage }

export interface StartTurnResult {
  turnId: string
  conversationId: string
  userMessage: ChatMessage
}

export interface ConfirmRequest {
  actionId: string
  turnId: string
  label: string
  summary: string
  details: string[]
  source: MessageSource
}

export interface TranscriptionResult {
  text: string
}

export interface SynthesisResult {
  audio: ArrayBuffer
  mimeType: string
}
