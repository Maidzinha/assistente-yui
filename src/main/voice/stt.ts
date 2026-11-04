import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { ProviderStatus, Settings, TranscriptionResult } from '@shared/types'
import { ensureWorker, stopWorker, workerScript, workerState, type WorkerSpec } from './workers'
import { joinUrl, request } from '../ai/http'
import { ProviderError } from '../ai/types'
import { getSecret } from '../config/store'
import { addGroqAudio, isGroq, recordGroqHeaders } from '../usage'

/** Adaptador substituível de reconhecimento de fala. Recebe WAV 16 kHz mono. */
export interface SttAdapter {
  transcribe(wav: ArrayBuffer, language: string, signal?: AbortSignal): Promise<TranscriptionResult>
  health(): Promise<ProviderStatus>
}

const shortLang = (lang: string) => lang.split('-')[0]

/** whisper.cpp → whisper-server (https://github.com/ggml-org/whisper.cpp). */
class WhisperCppAdapter implements SttAdapter {
  constructor(private readonly baseUrl: string) {}

  async transcribe(wav: ArrayBuffer, language: string, signal?: AbortSignal) {
    const form = new FormData()
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'fala.wav')
    form.append('language', shortLang(language))
    form.append('response_format', 'json')
    form.append('temperature', '0')
    const res = await request(joinUrl(this.baseUrl, '/inference'), { method: 'POST', body: form, signal, timeoutMs: 60_000 }, 'whisper.cpp')
    const data = (await res.json()) as { text?: string; error?: string }
    if (data.error) throw new ProviderError(`whisper.cpp: ${data.error}`)
    return { text: (data.text ?? '').trim() }
  }

  async health(): Promise<ProviderStatus> {
    try {
      await request(this.baseUrl, { timeoutMs: 3000 }, 'whisper.cpp')
      return { ok: true, message: 'whisper.cpp local' }
    } catch (err) {
      return {
        ok: false,
        message: (err as Error).message,
        hint: [
          'Baixe o whisper.cpp para Windows (releases em github.com/ggml-org/whisper.cpp).',
          'Baixe um modelo multilíngue, por exemplo ggml-small.bin ou ggml-large-v3-turbo.bin.',
          `Inicie: whisper-server.exe -m ggml-small.bin -l pt --port ${new URL(this.baseUrl).port || '8080'}`
        ]
      }
    }
  }
}

/** Servidores locais com /v1/audio/transcriptions (Speaches/faster-whisper-server, LocalAI). */
class OpenAiCompatibleStt implements SttAdapter {
  constructor(private readonly baseUrl: string, private readonly model: string, private readonly apiKey?: string) {}

  private auth(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}
  }

  async transcribe(wav: ArrayBuffer, language: string, signal?: AbortSignal) {
    const form = new FormData()
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'fala.wav')
    form.append('model', this.model)
    form.append('language', shortLang(language))
    form.append('response_format', 'json')
    const groq = isGroq(this.baseUrl)
    const res = await request(joinUrl(this.baseUrl, '/audio/transcriptions'),
      { method: 'POST', body: form, headers: this.auth(), signal, timeoutMs: 60_000 }, groq ? 'Groq' : 'servidor de transcrição')
    if (groq) {
      recordGroqHeaders('audio', res.headers)
      // WAV 16 kHz mono 16 bits: 32.000 bytes por segundo, depois do cabeçalho de 44 bytes.
      void addGroqAudio(this.model, Math.max(0, wav.byteLength - 44) / 32_000)
    }
    const data = (await res.json()) as { text?: string }
    return { text: (data.text ?? '').trim() }
  }

  async health(): Promise<ProviderStatus> {
    const groq = isGroq(this.baseUrl)
    try {
      await request(joinUrl(this.baseUrl, '/models'), { headers: this.auth(), timeoutMs: 5000 }, groq ? 'Groq' : 'servidor de transcrição')
      return { ok: true, message: groq ? `Groq · ${this.model} · na nuvem` : `Transcrição local · ${this.model}` }
    } catch (err) {
      return {
        ok: false,
        message: (err as Error).message,
        hint: ['Inicie um servidor local compatível (por exemplo Speaches/faster-whisper-server).', 'Use a URL base terminando em /v1.']
      }
    }
  }
}

const STT_PORT = 5593

/** faster-whisper num processo Python local que o próprio app inicia (como a voz personalizada). */
class LocalWhisperAdapter implements SttAdapter {
  constructor(private readonly python: string, private readonly model: string, private readonly device: 'cpu' | 'cuda') {}

  private spec(): WorkerSpec {
    return {
      name: 'whisper',
      python: this.python,
      script: workerScript('stt_worker.py'),
      port: STT_PORT,
      // Na primeira vez o modelo é baixado.
      startTimeoutMs: 600_000,
      args: ['--model', this.model || 'small', '--device', this.device]
    }
  }

  prewarm(): void {
    void ensureWorker(this.spec()).catch(() => {})
  }

  async transcribe(wav: ArrayBuffer, language: string, signal?: AbortSignal) {
    const url = await ensureWorker(this.spec())
    const path = join(app.getPath('temp'), `assistente-fala-${randomUUID()}.wav`)
    try {
      await fs.writeFile(path, Buffer.from(wav))
      const res = await request(`${url}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, language: shortLang(language) }),
        signal,
        timeoutMs: 60_000
      }, 'reconhecimento de fala')
      const data = (await res.json()) as { ok: boolean; text?: string; error?: string }
      if (!data.ok) throw new ProviderError(`Reconhecimento de fala: ${data.error ?? 'erro desconhecido'}`)
      return { text: (data.text ?? '').trim() }
    } finally {
      // A gravação da sua voz nunca fica salva em disco.
      await fs.rm(path, { force: true })
    }
  }

  async health(): Promise<ProviderStatus> {
    const ok = !!this.python && (await fs.stat(this.python).then((s) => s.isFile(), () => false))
    if (!ok) {
      return {
        ok: false,
        message: `Python do Whisper não encontrado: ${this.python || '(vazio)'}`,
        hint: ['Crie um ambiente Python com: pip install faster-whisper', 'Informe o python.exe desse ambiente em Configurações → Voz.']
      }
    }
    const s = workerState('whisper')
    if (s.status === 'failed') return { ok: false, message: 'O reconhecimento de fala falhou.', hint: [s.error, 'Clique em “Verificar conexões” para tentar de novo.'] }
    return { ok: true, message: s.status === 'ready' ? `Whisper ${this.model} · pronto` : `Whisper ${this.model} · carregando…` }
  }
}

export async function prewarmStt(settings: Settings): Promise<void> {
  const stt = await getStt(settings)
  if (!(stt instanceof LocalWhisperAdapter)) {
    stopWorker('whisper')
    return
  }
  if ((await stt.health()).ok) stt.prewarm()
}

export async function getStt(settings: Settings): Promise<SttAdapter | null> {
  const { provider, baseUrl, model } = settings.stt
  if (provider === 'none') return null
  if (provider === 'local-whisper') return new LocalWhisperAdapter(settings.stt.whisperPython, settings.stt.whisperModel, settings.stt.whisperDevice)
  if (provider === 'openai-compatible') return new OpenAiCompatibleStt(baseUrl, model, await getSecret('sttApiKey'))
  return new WhisperCppAdapter(baseUrl)
}

export async function sttHealth(settings: Settings): Promise<ProviderStatus> {
  const stt = await getStt(settings)
  if (!stt) {
    return { ok: false, message: 'Reconhecimento de fala desativado.', hint: ['Escolha um provedor de transcrição em Configurações → Voz.'] }
  }
  return stt.health()
}
