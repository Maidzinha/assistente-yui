import { ProviderError } from './types'

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/** fetch com mensagens de erro legíveis em pt-BR. */
export async function request(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  serviceName: string
): Promise<Response> {
  const timeout = init.timeoutMs ? AbortSignal.timeout(init.timeoutMs) : undefined
  const signal =
    init.signal && timeout ? AbortSignal.any([init.signal, timeout]) : (init.signal ?? timeout)
  let res: Response
  try {
    res = await fetch(url, { ...init, signal })
  } catch (err) {
    if (init.signal?.aborted) throw err
    if ((err as Error).name === 'TimeoutError') {
      throw new ProviderError(`${serviceName} demorou demais para responder (${url}).`)
    }
    throw new ProviderError(`Não foi possível conectar ao ${serviceName} em ${url}. Ele está em execução?`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 429) throw new RateLimitError(serviceName, retryDelayMs(res.headers, body))
    throw new ProviderError(`${serviceName} respondeu com erro ${res.status}: ${body.slice(0, 300) || res.statusText}`)
  }
  return res
}

/** Limite por minuto estourado: diz quanto esperar antes de tentar de novo. */
export class RateLimitError extends ProviderError {
  constructor(serviceName: string, readonly waitMs: number) {
    super(`${serviceName} atingiu o limite gratuito por minuto. Espere uns ${Math.ceil(waitMs / 1000)} segundos e tente de novo.`)
  }
}

function retryDelayMs(headers: Headers, body: string): number {
  const after = Number(headers.get('retry-after'))
  if (after > 0) return after * 1000
  // A Groq escreve "Please try again in 8.07s" ou "in 1m2.5s" na mensagem.
  const m = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(body)
  if (m) return ((Number(m[1] ?? 0) * 60) + Number(m[2])) * 1000
  return 10_000
}

/** Espera respeitando o cancelamento (botão parar). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = () => { clearTimeout(t); reject(signal!.reason) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Lê um corpo em streaming linha a linha. */
export async function* readLines(res: Response): AsyncGenerator<string> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (line) yield line
    }
  }
  if (buffer.trim()) yield buffer.trim()
}
