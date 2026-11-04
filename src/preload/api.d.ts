import type {
  ChatEvent, ConfirmRequest, Conversation, ConversationSummary, MemoryItem, MessageSource, ProvidersStatus,
  SecretKey, SecretsInfo, Settings, StartTurnResult, SynthesisResult, TranscriptionResult, UsageInfo
} from '../shared/types'

export interface AssistantApi {
  settings: {
    get(): Promise<Settings>
    save(settings: Settings): Promise<Settings>
    secretsInfo(): Promise<SecretsInfo>
    setSecret(key: SecretKey, value: string | null): Promise<void>
    providersStatus(): Promise<ProvidersStatus>
  }
  chat: {
    send(conversationId: string | null, text: string, source: MessageSource): Promise<StartTurnResult>
    cancel(turnId: string): void
    onEvent(cb: (event: ChatEvent) => void): () => void
  }
  history: {
    list(): Promise<ConversationSummary[]>
    get(id: string): Promise<Conversation | null>
    remove(id: string): Promise<void>
  }
  actions: {
    onConfirmRequest(cb: (req: ConfirmRequest) => void): () => void
    respond(actionId: string, approved: boolean): void
    cancel(actionId: string): void
  }
  usage: {
    get(): Promise<UsageInfo>
  }
  avatar: {
    /** Abre a janela para escolher o .vrm; devolve o nome ou null se cancelar. */
    pick(): Promise<string | null>
    load(): Promise<ArrayBuffer | null>
    remove(): Promise<void>
  }
  memory: {
    list(): Promise<MemoryItem[]>
    remove(id: string): Promise<void>
    clear(): Promise<void>
  }
  voice: {
    transcribe(wav: ArrayBuffer, language: string): Promise<TranscriptionResult>
    synthesize(text: string): Promise<SynthesisResult>
  }
}

declare global {
  interface Window {
    assistant?: AssistantApi
  }
}
