import { randomUUID } from 'node:crypto'
import type { ProviderStatus } from '@shared/types'
import { addGroqTokens, isGroq, recordGroqHeaders } from '../usage'
import { joinUrl, RateLimitError, readLines, request, sleep } from './http'
import { ProviderError, type LlmAdapter, type LlmMessage, type LlmRequest, type LlmResponse } from './types'

interface Options {
  baseUrl: string
  model: string
  temperature: number
  apiKey?: string
}

/** Servidores locais compatíveis com a API OpenAI: LM Studio, llama.cpp server, vLLM, Jan… */
export class OpenAiCompatibleAdapter implements LlmAdapter {
  private readonly groq: boolean
  constructor(private readonly opts: Options) {
    this.groq = isGroq(opts.baseUrl)
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {})
    }
  }

  private toWire(messages: LlmMessage[]) {
    return messages.map((m) => {
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
      if (m.toolCalls?.length) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.arguments) }
          }))
        }
      }
      return { role: m.role, content: m.content }
    })
  }

  async chat(req: LlmRequest): Promise<LlmResponse> {
    const body = {
      model: this.opts.model,
      stream: true,
      temperature: this.opts.temperature,
      messages: this.toWire(req.messages),
      ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: 'function', function: t })) } : {}),
      // Na Groq, pede o total de tokens no fim do streaming para somar o gasto do mês.
      ...(this.groq ? { stream_options: { include_usage: true } } : {}),
      // Respostas curtas de conversa: limita o tamanho e, nos modelos gpt-oss, pensa pouco
      // (o "pensamento" também conta no limite de tokens por minuto do plano gratuito).
      ...(this.groq ? { max_completion_tokens: 1024 } : {}),
      ...(this.groq && /gpt-oss/.test(this.opts.model) ? { reasoning_effort: 'low' } : {})
    }
    const send = () => request(
      joinUrl(this.opts.baseUrl, '/chat/completions'),
      { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: req.signal },
      this.groq ? 'Groq' : 'servidor de IA'
    )
    // Limite por minuto: espera o tempo pedido e tenta de novo, até 3 vezes (no máximo ~1 min no total).
    let res: Response
    for (let attempt = 0; ; attempt++) {
      try {
        res = await send()
        break
      } catch (err) {
        if (!(err instanceof RateLimitError) || attempt >= 3 || err.waitMs > 30_000) throw err
        await sleep(err.waitMs + 500, req.signal)
      }
    }
    if (this.groq) recordGroqHeaders('chat', res.headers)

    let content = ''
    let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined
    const partial = new Map<number, { id: string; name: string; args: string }>()
    for await (const line of readLines(res)) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') break
      const chunk = JSON.parse(data)
      if (chunk.error) throw new ProviderError(`Servidor de IA: ${chunk.error.message ?? chunk.error}`)
      usage = chunk.usage ?? chunk.x_groq?.usage ?? usage
      const delta = chunk.choices?.[0]?.delta ?? {}
      if (delta.content) {
        content += delta.content
        req.onDelta(delta.content)
      }
      for (const tc of delta.tool_calls ?? []) {
        const entry = partial.get(tc.index ?? 0) ?? { id: tc.id ?? randomUUID(), name: '', args: '' }
        if (tc.function?.name) entry.name += tc.function.name
        if (tc.function?.arguments) entry.args += tc.function.arguments
        partial.set(tc.index ?? 0, entry)
      }
    }

    if (this.groq && usage) void addGroqTokens(this.opts.model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0)

    const toolCalls = [...partial.values()].map((p) => {
      let args: Record<string, unknown> = {}
      try { args = p.args ? JSON.parse(p.args) : {} } catch { /* argumentos inválidos viram objeto vazio */ }
      return { id: p.id, name: p.name, arguments: args }
    })
    return { content, toolCalls }
  }

  async health(): Promise<ProviderStatus> {
    try {
      await request(joinUrl(this.opts.baseUrl, '/models'), { headers: this.headers(), timeoutMs: 5000 }, this.groq ? 'Groq' : 'servidor de IA')
      return { ok: true, message: this.groq ? `Groq · ${this.opts.model} · na nuvem` : `Servidor local · ${this.opts.model}` }
    } catch (err) {
      return {
        ok: false,
        message: (err as Error).message,
        hint: this.groq ? [
          'Confira a internet e a chave de API da Groq (console.groq.com → API Keys).',
          'Endereço: https://api.groq.com/openai/v1 · modelo: openai/gpt-oss-20b.'
        ] : [
          'Inicie o servidor local (LM Studio → aba Developer → Start Server, ou llama-server).',
          'Use a URL base terminando em /v1, por exemplo http://127.0.0.1:1234/v1.',
          'Informe o nome do modelo carregado nas configurações.'
        ]
      }
    }
  }
}
