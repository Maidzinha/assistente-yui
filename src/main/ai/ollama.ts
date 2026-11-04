import { randomUUID } from 'node:crypto'
import type { ProviderStatus } from '@shared/types'
import { joinUrl, readLines, request } from './http'
import { ProviderError, type LlmAdapter, type LlmMessage, type LlmRequest, type LlmResponse } from './types'

interface Options {
  baseUrl: string
  model: string
  temperature: number
}

/** Ollama rodando localmente (https://ollama.com). */
export class OllamaAdapter implements LlmAdapter {
  private toolsUnsupported = false

  constructor(private readonly opts: Options) {}

  private toWire(messages: LlmMessage[]) {
    return messages.map((m) => {
      if (m.role === 'tool') return { role: 'tool', content: m.content, tool_name: m.toolName }
      if (m.toolCalls?.length) {
        return {
          role: 'assistant',
          content: m.content,
          tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } }))
        }
      }
      return { role: m.role, content: m.content }
    })
  }

  async chat(req: LlmRequest): Promise<LlmResponse> {
    const useTools = req.tools.length > 0 && !this.toolsUnsupported
    const body = {
      model: this.opts.model,
      stream: true,
      messages: this.toWire(req.messages),
      options: { temperature: this.opts.temperature },
      ...(useTools
        ? { tools: req.tools.map((t) => ({ type: 'function', function: t })) }
        : {})
    }

    let res: Response
    try {
      res = await request(
        joinUrl(this.opts.baseUrl, '/api/chat'),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: req.signal },
        'Ollama'
      )
    } catch (err) {
      const msg = (err as Error).message
      if (useTools && /does not support tools/i.test(msg)) {
        // Modelo sem suporte a ferramentas: segue só com texto.
        this.toolsUnsupported = true
        return this.chat(req)
      }
      if (/not found/i.test(msg) && /model/i.test(msg)) {
        throw new ProviderError(`O modelo "${this.opts.model}" não está instalado no Ollama.`, [
          `Abra um terminal e rode: ollama pull ${this.opts.model}`
        ])
      }
      throw err
    }

    let content = ''
    const toolCalls: LlmResponse['toolCalls'] = []
    for await (const line of readLines(res)) {
      const chunk = JSON.parse(line)
      if (chunk.error) throw new ProviderError(`Ollama: ${chunk.error}`)
      const piece: string = chunk.message?.content ?? ''
      if (piece) {
        content += piece
        req.onDelta(piece)
      }
      for (const call of chunk.message?.tool_calls ?? []) {
        let args = call.function?.arguments ?? {}
        if (typeof args === 'string') {
          try { args = JSON.parse(args) } catch { args = {} }
        }
        toolCalls.push({ id: randomUUID(), name: call.function?.name ?? '', arguments: args })
      }
    }
    return { content, toolCalls }
  }

  async health(): Promise<ProviderStatus> {
    try {
      const res = await request(joinUrl(this.opts.baseUrl, '/api/tags'), { timeoutMs: 3000 }, 'Ollama')
      const data = (await res.json()) as { models?: { name: string }[] }
      const names = (data.models ?? []).map((m) => m.name)
      const wanted = this.opts.model.includes(':') ? this.opts.model : `${this.opts.model}:latest`
      if (!names.includes(wanted) && !names.includes(this.opts.model)) {
        return {
          ok: false,
          message: `Ollama conectado, mas o modelo "${this.opts.model}" não está instalado.`,
          hint: [
            `Rode no terminal: ollama pull ${this.opts.model}`,
            names.length ? `Modelos disponíveis: ${names.join(', ')}` : 'Nenhum modelo instalado ainda.'
          ]
        }
      }
      return { ok: true, message: `Ollama · ${this.opts.model}` }
    } catch (err) {
      return {
        ok: false,
        message: (err as Error).message,
        hint: [
          'Instale o Ollama em https://ollama.com/download.',
          'Inicie o serviço (abra o aplicativo Ollama ou rode: ollama serve).',
          `Baixe um modelo, por exemplo: ollama pull ${this.opts.model}`
        ]
      }
    }
  }
}
