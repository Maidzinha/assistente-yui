import type { ActionRecord, ChatMessage, ConfirmRequest, MessageSource, Settings } from '@shared/types'
import { modelUnderstandsTags } from '@shared/voiceTags'
import { runToolCall, toolSpecs } from '../actions/runner'
import { listMemories } from '../memory/store'
import { getLlm } from './index'
import { systemPrompt } from './persona'
import type { LlmMessage } from './types'

const MAX_TOOL_ROUNDS = 5
const HISTORY_LIMIT = 24

export interface TurnInput {
  turnId: string
  settings: Settings
  history: ChatMessage[]
  source: MessageSource
  signal: AbortSignal
  onDelta(text: string): void
  onAction(record: ActionRecord): void
  requestConfirmation(req: ConfirmRequest): Promise<boolean>
}

export interface TurnOutput {
  content: string
  actions: ActionRecord[]
}

/** Laço de conversa: o modelo responde ou pede ferramentas da lista permitida. */
export async function runTurn(input: TurnInput): Promise<TurnOutput> {
  const llm = await getLlm(input.settings)
  const { tts, voice } = input.settings
  // Só pede marcações de emoção quando a resposta vai ser falada por um modelo que as entende.
  const spoken = input.source === 'voice' ? voice.spokenReplies : voice.speakTextReplies
  const expressive = spoken && modelUnderstandsTags(tts.provider, tts.elevenModel)
  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt(input.source, voice.language, expressive, (await listMemories()).map((m) => m.text)) },
    ...input.history.slice(-HISTORY_LIMIT).map((m) => ({ role: m.role, content: m.content }) as LlmMessage)
  ]
  const actions: ActionRecord[] = []
  let content = ''
  let needsSeparator = false
  const onDelta = (text: string) => {
    if (needsSeparator) {
      input.onDelta('\n\n')
      needsSeparator = false
    }
    input.onDelta(text)
  }

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const tools = round < MAX_TOOL_ROUNDS ? toolSpecs() : []
    const res = await llm.chat({ messages, tools, signal: input.signal, onDelta })
    if (res.content) {
      content += (content ? '\n\n' : '') + res.content
      needsSeparator = true
    }
    if (!res.toolCalls.length) break

    messages.push({ role: 'assistant', content: res.content, toolCalls: res.toolCalls })
    for (const call of res.toolCalls) {
      if (input.signal.aborted) break
      const { output } = await runToolCall(call, {
        turnId: input.turnId,
        source: input.source,
        signal: input.signal,
        onUpdate: (r) => {
          const idx = actions.findIndex((a) => a.id === r.id)
          if (idx >= 0) actions[idx] = r
          else actions.push(r)
          input.onAction(r)
        },
        requestConfirmation: input.requestConfirmation
      })
      messages.push({ role: 'tool', content: output, toolCallId: call.id, toolName: call.name })
    }
    if (input.signal.aborted) break
  }

  return { content: content.trim(), actions }
}
