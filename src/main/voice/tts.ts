import { app } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { CustomVoiceSettings, ProviderStatus, Settings, SynthesisResult } from '@shared/types'
import { startsWithVoiceTag, stripVoiceTags } from '@shared/voiceTags'
import { joinUrl, request } from '../ai/http'
import { ProviderError } from '../ai/types'
import { getSecret } from '../config/store'
import { ensureWorker, stopWorker, workerScript, workerState, type WorkerSpec } from './workers'

/**
 * Adaptador substituível de síntese de voz executado no processo principal.
 * O provedor "system" (vozes do Windows) é tocado direto na interface via speechSynthesis.
 */
export interface TtsAdapter {
  synthesize(text: string, signal?: AbortSignal): Promise<SynthesisResult>
  health(): Promise<ProviderStatus>
}

/** Piper (https://github.com/rhasspy/piper) — executável local + modelo .onnx (ex.: pt_BR-faber-medium). */
class PiperAdapter implements TtsAdapter {
  constructor(private readonly exe: string, private readonly model: string, private readonly rate: number) {}

  async synthesize(text: string, signal?: AbortSignal): Promise<SynthesisResult> {
    const out = join(app.getPath('temp'), `assistente-tts-${randomUUID()}.wav`)
    const lengthScale = (1 / Math.max(0.5, Math.min(2, this.rate || 1))).toFixed(2)
    try {
      await new Promise<void>((resolve, reject) => {
        // Argumentos fixos; o texto vai pela entrada padrão, nunca pela linha de comando.
        const child = spawn(this.exe, ['--model', this.model, '--output_file', out, '--length_scale', lengthScale], {
          windowsHide: true,
          shell: false
        })
        let stderr = ''
        child.stderr.on('data', (d) => (stderr += d.toString()))
        child.on('error', (err) => reject(new ProviderError(`Não foi possível iniciar o Piper: ${err.message}`)))
        child.on('close', (code) =>
          code === 0 ? resolve() : reject(new ProviderError(`Piper terminou com erro (${code}): ${stderr.slice(-300)}`))
        )
        signal?.addEventListener('abort', () => child.kill())
        child.stdin.end(text.replace(/\s+/g, ' '), 'utf8')
      })
      const buf = await fs.readFile(out)
      return { audio: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, mimeType: 'audio/wav' }
    } finally {
      // O áudio sintetizado nunca fica salvo em disco.
      await fs.rm(out, { force: true })
    }
  }

  async health(): Promise<ProviderStatus> {
    const hint = [
      'Baixe o Piper para Windows em github.com/rhasspy/piper/releases.',
      'Baixe uma voz pt-BR (arquivos .onnx e .onnx.json), por exemplo pt_BR-faber-medium.',
      'Informe o caminho do piper.exe e do arquivo .onnx em Configurações → Voz.'
    ]
    if (!this.exe || !this.model) return { ok: false, message: 'Piper não configurado.', hint }
    const okExe = await fs.stat(this.exe).then((s) => s.isFile(), () => false)
    const okModel = await fs.stat(this.model).then((s) => s.isFile(), () => false)
    if (!okExe) return { ok: false, message: `piper.exe não encontrado em ${this.exe}`, hint }
    if (!okModel) return { ok: false, message: `Modelo de voz não encontrado em ${this.model}`, hint }
    return { ok: true, message: 'Piper local' }
  }
}

/** Servidores locais com /v1/audio/speech (Kokoro-FastAPI, Speaches, LocalAI). */
class OpenAiCompatibleTts implements TtsAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly voice: string,
    private readonly rate: number,
    private readonly apiKey?: string
  ) {}

  private auth(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<SynthesisResult> {
    const res = await request(joinUrl(this.baseUrl, '/audio/speech'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.auth() },
      body: JSON.stringify({ model: this.model, input: text, voice: this.voice || 'pf_dora', speed: this.rate, response_format: 'wav' }),
      signal,
      timeoutMs: 60_000
    }, 'servidor de voz')
    return { audio: await res.arrayBuffer(), mimeType: res.headers.get('content-type') ?? 'audio/wav' }
  }

  async health(): Promise<ProviderStatus> {
    try {
      await request(joinUrl(this.baseUrl, '/models'), { headers: this.auth(), timeoutMs: 3000 }, 'servidor de voz')
      return { ok: true, message: `Voz local · ${this.model}` }
    } catch (err) {
      return {
        ok: false,
        message: (err as Error).message,
        hint: ['Inicie um servidor local de voz compatível (por exemplo Kokoro-FastAPI na porta 8880).', 'Use a URL base terminando em /v1.']
      }
    }
  }
}

const FISH_API = 'https://api.fish.audio'

/**
 * Fish Audio (https://fish.audio): síntese na nuvem com uma voz clonada pelo usuário.
 * Nada roda no PC; só o texto da frase é enviado e o áudio MP3 volta pronto.
 */
class FishAudioAdapter implements TtsAdapter {
  constructor(
    private readonly voiceId: string,
    private readonly model: string,
    private readonly latency: string,
    private readonly language: string,
    private readonly rate: number,
    private readonly apiKey?: string
  ) {}

  private hint(extra: string[] = []): string[] {
    return [
      ...extra,
      'Crie a voz em fish.audio → Minhas vozes → Criar voz, enviando áudios limpos da voz que você quer.',
      'Copie o código da voz (aparece no endereço da página da voz) e cole em Configurações → Voz.',
      'Gere a chave em fish.audio → API Keys e salve no campo "Chave de API da Fish Audio".'
    ]
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<SynthesisResult> {
    if (!this.apiKey || !this.voiceId) throw new ProviderError('Fish Audio não configurada: falta a chave de API ou o código da voz.')
    const res = await request(`${FISH_API}/v1/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}`, model: this.model || 's2.1-pro' },
      body: JSON.stringify({
        text: text.replace(/\s+/g, ' '),
        reference_id: this.voiceId,
        format: 'mp3',
        mp3_bitrate: 128,
        latency: this.latency || 'balanced',
        language: this.language,
        normalize: true,
        prosody: { speed: Math.max(0.5, Math.min(2, this.rate || 1)) }
      }),
      signal,
      timeoutMs: 60_000
    }, 'Fish Audio')
    return { audio: await res.arrayBuffer(), mimeType: 'audio/mpeg' }
  }

  async health(): Promise<ProviderStatus> {
    if (!this.apiKey) return { ok: false, message: 'Fish Audio: falta a chave de API.', hint: this.hint() }
    if (!this.voiceId) return { ok: false, message: 'Fish Audio: falta o código da voz.', hint: this.hint() }
    try {
      const res = await request(`${FISH_API}/model/${encodeURIComponent(this.voiceId)}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeoutMs: 8000
      }, 'Fish Audio')
      const m = (await res.json()) as { title?: string; state?: string }
      if (m.state === 'failed') return { ok: false, message: `Fish Audio: a criação da voz "${m.title}" falhou.`, hint: this.hint(['Crie a voz de novo com áudios mais limpos.']) }
      if (m.state && m.state !== 'trained') return { ok: true, message: `Fish Audio · ${m.title ?? 'voz'} (ainda sendo preparada…)` }
      return { ok: true, message: `Fish Audio · ${m.title ?? 'voz'} · na nuvem` }
    } catch (err) {
      return { ok: false, message: (err as Error).message, hint: this.hint(['Confira a internet, a chave e o código da voz.']) }
    }
  }
}

const ELEVEN_API = 'https://api.elevenlabs.io'
const ELEVEN_TONES: Record<string, string> = {
  warm: '[softly] ',
  cute: '[playful] '
}

/**
 * ElevenLabs (https://elevenlabs.io): síntese na nuvem com a voz clonada pelo usuário.
 * Só o texto da frase é enviado; o áudio MP3 volta pronto.
 */
class ElevenLabsAdapter implements TtsAdapter {
  constructor(
    private readonly voiceId: string,
    private readonly model: string,
    private readonly stability: number,
    private readonly similarity: number,
    private readonly tone: string,
    private readonly language: string,
    private readonly rate: number,
    private readonly apiKey?: string
  ) {}

  private hint(extra: string[] = []): string[] {
    return [
      ...extra,
      'Crie a voz em elevenlabs.io → Voices → Create a Voice → Instant Voice Clone, enviando áudios limpos da voz que você quer.',
      'Copie o "Voice ID" da voz (menu ⋯ da voz → Copy voice ID) e cole em Configurações → Voz.',
      'Gere a chave em elevenlabs.io → Developers → API Keys e salve no campo "Chave de API da ElevenLabs".'
    ]
  }

  /** Traduz os erros mais comuns da ElevenLabs para algo que dá para resolver. */
  private explain(err: unknown): Error {
    const msg = (err as Error).message ?? String(err)
    // A falta de créditos também chega como 401, então é verificada antes.
    if (/quota_exceeded|erro 402/.test(msg)) return new ProviderError('Os créditos da ElevenLabs deste mês acabaram.')
    if (/erro 401/.test(msg)) return new ProviderError('ElevenLabs recusou a chave de API (confira a chave e as permissões de Text to Speech e Voices).')
    if (/erro 404|voice_not_found/.test(msg)) return new ProviderError('ElevenLabs não encontrou essa voz. Confira o Voice ID.')
    if (/erro 429/.test(msg)) return new ProviderError('ElevenLabs está limitando os pedidos agora. Tente de novo em alguns segundos.')
    return err as Error
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<SynthesisResult> {
    if (!this.apiKey || !this.voiceId) throw new ProviderError('ElevenLabs não configurada: falta a chave de API ou o Voice ID.')
    const model = this.model || 'eleven_v4'
    // Os modelos v3 e v4 entendem marcações de emoção no começo da frase (não são lidas em voz alta).
    // Se a IA já marcou a emoção da frase, ela vale mais que o jeito de falar padrão.
    const tag = /^eleven_v[34]/.test(model) && !startsWithVoiceTag(text) ? (ELEVEN_TONES[this.tone] ?? '') : ''
    const body: Record<string, unknown> = {
      text: tag + (/^eleven_v[34]/.test(model) ? text : stripVoiceTags(text)).replace(/\s+/g, ' '),
      model_id: model,
      voice_settings: {
        stability: this.stability,
        similarity_boost: this.similarity,
        style: 0,
        use_speaker_boost: true,
        speed: Math.max(0.7, Math.min(1.2, this.rate || 1))
      }
    }
    // O multilingual_v2 não aceita fixar o idioma; os outros aceitam e erram menos a pronúncia.
    if (model !== 'eleven_multilingual_v2') body.language_code = this.language
    try {
      const res = await request(`${ELEVEN_API}/v1/text-to-speech/${encodeURIComponent(this.voiceId)}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg', 'xi-api-key': this.apiKey },
        body: JSON.stringify(body),
        signal,
        timeoutMs: 60_000
      }, 'ElevenLabs')
      return { audio: await res.arrayBuffer(), mimeType: 'audio/mpeg' }
    } catch (err) {
      if (signal?.aborted) throw err
      throw this.explain(err)
    }
  }

  async health(): Promise<ProviderStatus> {
    if (!this.apiKey) return { ok: false, message: 'ElevenLabs: falta a chave de API.', hint: this.hint() }
    if (!this.voiceId) return { ok: false, message: 'ElevenLabs: falta o Voice ID.', hint: this.hint() }
    try {
      const res = await request(`${ELEVEN_API}/v1/voices/${encodeURIComponent(this.voiceId)}`, {
        headers: { 'xi-api-key': this.apiKey },
        timeoutMs: 8000
      }, 'ElevenLabs')
      const v = (await res.json()) as { name?: string }
      return { ok: true, message: `ElevenLabs · ${v.name ?? 'voz'} · na nuvem` }
    } catch (err) {
      return { ok: false, message: this.explain(err).message, hint: this.hint(['Confira a internet, a chave e o Voice ID.']) }
    }
  }
}

const XTTS_PORT = 5591
const RVC_PORT = 5592

async function isFile(p: string) {
  return !!p && (await fs.stat(p).then((s) => s.isFile(), () => false))
}
async function isDir(p: string) {
  return !!p && (await fs.stat(p).then((s) => s.isDirectory(), () => false))
}

/**
 * Voz personalizada treinada pelo usuário: XTTS v2 (com os latentes da voz) gera a fala
 * e o RVC aplica o timbre por cima. Cada parte roda num processo Python local.
 */
class CustomVoiceAdapter implements TtsAdapter {
  constructor(private readonly c: CustomVoiceSettings, private readonly language: string, private readonly rate: number) {}

  private xttsSpec(): WorkerSpec {
    return {
      name: 'xtts',
      python: this.c.xttsPython,
      script: workerScript('xtts_worker.py'),
      port: XTTS_PORT,
      startTimeoutMs: 180_000,
      args: [
        '--model-dir', this.c.xttsModelDir,
        '--latents', this.c.xttsLatents,
        '--language', this.language.split('-')[0],
        '--device', this.c.xttsDevice,
        '--speed', String(Math.max(0.6, Math.min(1.6, this.rate || 1)))
      ]
    }
  }

  private rvcSpec(): WorkerSpec {
    return {
      name: 'rvc',
      python: this.c.rvcPython,
      script: workerScript('rvc_worker.py'),
      port: RVC_PORT,
      startTimeoutMs: 180_000,
      args: [
        '--rvc-dir', this.c.rvcDir,
        '--model', this.c.rvcModel,
        '--index', this.c.rvcIndex,
        '--pitch', String(Math.round(this.c.rvcPitch)),
        '--f0', this.c.rvcF0Method,
        '--index-rate', String(this.c.rvcIndexRate),
        '--protect', String(this.c.rvcProtect),
        '--device', this.c.rvcDevice
      ]
    }
  }

  /** Começa a carregar os modelos em segundo plano para a primeira fala sair rápido. */
  prewarm(): void {
    void ensureWorker(this.xttsSpec()).catch(() => {})
    if (this.c.rvcEnabled) void ensureWorker(this.rvcSpec()).catch(() => {})
  }

  private async post(url: string, body: unknown, signal?: AbortSignal) {
    const res = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      timeoutMs: 120_000
    }, 'serviço de voz')
    const data = (await res.json()) as { ok: boolean; error?: string }
    if (!data.ok) throw new ProviderError(`Serviço de voz: ${data.error ?? 'erro desconhecido'}`)
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<SynthesisResult> {
    const [xtts, rvc] = await Promise.all([
      ensureWorker(this.xttsSpec()),
      this.c.rvcEnabled ? ensureWorker(this.rvcSpec()) : Promise.resolve(null)
    ])
    const id = randomUUID()
    const draft = join(app.getPath('temp'), `assistente-xtts-${id}.wav`)
    const final = join(app.getPath('temp'), `assistente-voz-${id}.wav`)
    try {
      await this.post(`${xtts}/say`, { text: text.replace(/\s+/g, ' '), path: draft }, signal)
      if (rvc) await this.post(`${rvc}/convert`, { input: draft, output: final }, signal)
      const buf = await fs.readFile(rvc ? final : draft)
      return { audio: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, mimeType: 'audio/wav' }
    } finally {
      // O áudio gerado nunca fica salvo em disco.
      await Promise.all([fs.rm(draft, { force: true }), fs.rm(final, { force: true })])
    }
  }

  async health(): Promise<ProviderStatus> {
    const c = this.c
    const missing: string[] = []
    if (!(await isFile(c.xttsPython))) missing.push(`Python do XTTS não encontrado: ${c.xttsPython || '(vazio)'}`)
    if (!(await isFile(join(c.xttsModelDir, 'model.pth')))) missing.push(`Modelo XTTS v2 (model.pth) não encontrado em: ${c.xttsModelDir || '(vazio)'}`)
    if (!(await isFile(c.xttsLatents))) missing.push(`Latentes da voz (.pt) não encontrados: ${c.xttsLatents || '(vazio)'}`)
    if (c.rvcEnabled) {
      if (!(await isFile(c.rvcPython))) missing.push(`Python do RVC não encontrado: ${c.rvcPython || '(vazio)'}`)
      if (!(await isDir(join(c.rvcDir, 'infer')))) missing.push(`Pasta do RVC (com infer\\) não encontrada: ${c.rvcDir || '(vazio)'}`)
      if (!(await isFile(c.rvcModel))) missing.push(`Modelo RVC (.pth) não encontrado: ${c.rvcModel || '(vazio)'}`)
      if (c.rvcIndex && !(await isFile(c.rvcIndex))) missing.push(`Índice RVC (.index) não encontrado: ${c.rvcIndex}`)
    }
    if (missing.length) {
      return { ok: false, message: `${c.name}: faltam arquivos.`, hint: [...missing, 'Ajuste os caminhos em Configurações → Voz.'] }
    }
    const states = [workerState('xtts'), ...(c.rvcEnabled ? [workerState('rvc')] : [])]
    const failed = states.find((s) => s.status === 'failed')
    if (failed && failed.status === 'failed') {
      return { ok: false, message: `${c.name}: o serviço de voz falhou.`, hint: [failed.error, 'Clique em “Verificar conexões” para tentar de novo.'] }
    }
    const ready = states.every((s) => s.status === 'ready')
    return { ok: true, message: ready ? `${c.name} · pronta` : `${c.name} · carregando os modelos…` }
  }
}

export async function prewarmTts(settings: Settings): Promise<void> {
  if (settings.tts.provider !== 'custom-voice') {
    stopWorker('xtts')
    stopWorker('rvc')
    return
  }
  const adapter = (await getTts(settings)) as CustomVoiceAdapter
  if ((await adapter.health()).ok) adapter.prewarm()
}

export async function getTts(settings: Settings): Promise<TtsAdapter | null> {
  const t = settings.tts
  if (t.provider === 'custom-voice') return new CustomVoiceAdapter(t.custom, settings.voice.language, t.rate)
  if (t.provider === 'elevenlabs') {
    return new ElevenLabsAdapter(t.elevenVoiceId.trim(), t.elevenModel, t.elevenStability, t.elevenSimilarity, t.elevenTone,
      settings.voice.language.split('-')[0], t.rate, await getSecret('elevenApiKey'))
  }
  if (t.provider === 'fish-audio') {
    return new FishAudioAdapter(t.fishVoiceId.trim(), t.fishModel, t.fishLatency, settings.voice.language.split('-')[0], t.rate, await getSecret('ttsApiKey'))
  }
  if (t.provider === 'piper') return new PiperAdapter(t.piperPath, t.piperModel, t.rate)
  if (t.provider === 'openai-compatible') return new OpenAiCompatibleTts(t.baseUrl, t.model, t.voice, t.rate, await getSecret('ttsApiKey'))
  return null
}

export async function ttsHealth(settings: Settings): Promise<ProviderStatus> {
  if (settings.tts.provider === 'none') return { ok: false, message: 'Respostas faladas desativadas.', hint: ['Escolha uma voz em Configurações → Voz.'] }
  if (settings.tts.provider === 'system') return { ok: true, message: 'Vozes do Windows' }
  return (await getTts(settings))!.health()
}
