import type { Settings } from '@shared/types'
import { modelUnderstandsTags, stripVoiceTags } from '@shared/voiceTags'
import { api, errorMessage } from './api'
import { attachAudio, detachAudio } from './lipsync'

/** Remove marcações para que a voz não leia asteriscos, crases ou links. */
export function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_#>~]+/g, '')
    .replace(/[A-Za-z]:\\[^\s]+/g, (p) => p.split('\\').pop() ?? p)
    .replace(/\s+/g, ' ')
    .trim()
}

interface Sentence {
  raw: string
  audio?: Promise<HTMLAudioElement | null>
}

export interface SpeakerCallbacks {
  /** Frase que começou a tocar (texto original, para destacar na conversa). */
  onSentence(raw: string | null): void
  onIdle(): void
  onError(message: string): void
}

/**
 * Fala a resposta em frases enquanto ela ainda está sendo gerada, para reduzir a latência.
 * Usa as vozes do Windows (speechSynthesis) ou um adaptador do processo principal (Piper, servidor local).
 */
export class Speaker {
  private buffer = ''
  private queue: Sentence[] = []
  private playing = false
  private ended = false
  private cancelled = false
  private currentAudio: HTMLAudioElement | null = null
  private synthChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly settings: Settings, private readonly cb: SpeakerCallbacks) {}

  feed(delta: string) {
    if (this.cancelled) return
    this.buffer += delta
    // Uma frase termina em pontuação seguida de espaço, ou em quebra de linha.
    const re = /[.!?…]+["')\]]*\s+|\n+/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(this.buffer))) {
      const end = m.index + m[0].length
      this.enqueue(this.buffer.slice(last, end))
      last = end
    }
    this.buffer = this.buffer.slice(last)
  }

  end() {
    if (this.buffer.trim()) this.enqueue(this.buffer)
    this.buffer = ''
    this.ended = true
    if (!this.playing && !this.queue.length) this.cb.onIdle()
  }

  stop() {
    this.cancelled = true
    this.queue = []
    if (this.settings.tts.provider === 'system') window.speechSynthesis.cancel()
    this.currentAudio?.pause()
    this.currentAudio = null
    this.cb.onSentence(null)
  }

  private enqueue(raw: string) {
    const t = this.settings.tts
    // Marcações de emoção só seguem para modelos que as entendem; os outros as leriam em voz alta.
    const clean = modelUnderstandsTags(t.provider, t.elevenModel) ? toSpeakable(raw) : toSpeakable(stripVoiceTags(raw))
    const speakable = stripVoiceTags(clean).trim() ? clean : ''
    if (!speakable) return
    const s: Sentence = { raw: raw.trim() }
    if (this.settings.tts.provider !== 'system') {
      // Sintetiza em sequência, adiantado em relação à reprodução.
      const audio = this.synthChain.then(() => this.synthesize(speakable))
      s.audio = audio
      this.synthChain = audio
    }
    this.queue.push(s)
    if (!this.playing) void this.playNext()
  }

  private async synthesize(text: string): Promise<HTMLAudioElement | null> {
    if (this.cancelled || !api) return null
    try {
      const { audio, mimeType } = await api.voice.synthesize(text)
      const url = URL.createObjectURL(new Blob([audio], { type: mimeType }))
      const el = new Audio(url)
      el.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true })
      return el
    } catch (err) {
      this.cb.onError(errorMessage(err))
      return null
    }
  }

  private async playNext(): Promise<void> {
    const next = this.queue.shift()
    if (!next || this.cancelled) {
      this.playing = false
      this.cb.onSentence(null)
      if (this.ended || this.cancelled) this.cb.onIdle()
      return
    }
    this.playing = true
    if (this.settings.tts.provider === 'system') await this.speakSystem(next.raw)
    else {
      const audio = await next.audio
      if (audio && !this.cancelled) {
        this.currentAudio = audio
        await attachAudio(audio)
        this.cb.onSentence(next.raw)
        await new Promise<void>((resolve) => {
          audio.onended = audio.onerror = audio.onpause = () => resolve()
          audio.play().catch(() => resolve())
        })
        detachAudio()
      }
    }
    void this.playNext()
  }

  private speakSystem(raw: string): Promise<void> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(toSpeakable(stripVoiceTags(raw)))
      const lang = this.settings.voice.language
      const voices = window.speechSynthesis.getVoices()
      u.voice =
        voices.find((v) => v.name === this.settings.tts.voice) ??
        voices.find((v) => v.lang.replace('_', '-') === lang) ??
        null
      u.lang = lang
      u.rate = this.settings.tts.rate || 1
      u.pitch = 1.1
      u.onstart = () => this.cb.onSentence(raw)
      u.onend = () => resolve()
      u.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') this.cb.onError(`Falha na voz do Windows: ${e.error}`)
        resolve()
      }
      window.speechSynthesis.speak(u)
    })
  }
}

export function listSystemVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices()
    if (voices.length) return resolve(voices)
    const timer = setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1500)
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      clearTimeout(timer)
      resolve(window.speechSynthesis.getVoices())
    }, { once: true })
  })
}
