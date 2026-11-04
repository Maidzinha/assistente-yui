import type { ProviderStatus } from '@shared/types'

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  toolName?: string
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface LlmRequest {
  messages: LlmMessage[]
  tools: ToolSpec[]
  signal: AbortSignal
  onDelta: (text: string) => void
}

export interface LlmResponse {
  content: string
  toolCalls: ToolCall[]
}

/** Adaptador substituível de modelo de linguagem. */
export interface LlmAdapter {
  chat(req: LlmRequest): Promise<LlmResponse>
  health(): Promise<ProviderStatus>
}

export class ProviderError extends Error {
  constructor(message: string, readonly hint?: string[]) {
    super(message)
  }
}
