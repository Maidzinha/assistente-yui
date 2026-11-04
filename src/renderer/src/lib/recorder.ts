// Captura do microfone em memória e conversão para WAV 16 kHz mono (formato do Whisper).
// Nada é salvo em disco: o buffer é descartado após a transcrição.

const TARGET_RATE = 16_000
const SPEECH_RMS = 0.025
const SILENCE_MS = 1300
const MAX_MS = 60_000
const NO_SPEECH_MS = 8000

export interface RecorderCallbacks {
  onLevel(level: number): void
  /** Chamado quando a fala termina (silêncio) ou o tempo máximo é atingido. */
  onAutoStop(reason: 'silence' | 'max' | 'no-speech'): void
}

export class MicRecorder {
  private stream?: MediaStream
  private ctx?: AudioContext
  private processor?: ScriptProcessorNode
  private chunks: Float32Array[] = []
  private heardSpeech = false
  private startedAt = 0
  private lastVoiceAt = 0
  private stopped = false

  async start(cb: RecorderCallbacks, autoStop: boolean): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    this.ctx = new AudioContext()
    const source = this.ctx.createMediaStreamSource(this.stream)
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1)
    this.startedAt = this.lastVoiceAt = performance.now()

    this.processor.onaudioprocess = (e) => {
      if (this.stopped) return
      const input = e.inputBuffer.getChannelData(0)
      this.chunks.push(new Float32Array(input))
      let sum = 0
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
      const rms = Math.sqrt(sum / input.length)
      cb.onLevel(Math.min(1, rms * 8))

      const now = performance.now()
      if (rms > SPEECH_RMS) {
        this.heardSpeech = true
        this.lastVoiceAt = now
      }
      if (now - this.startedAt > MAX_MS) cb.onAutoStop('max')
      else if (autoStop && this.heardSpeech && now - this.lastVoiceAt > SILENCE_MS) cb.onAutoStop('silence')
      else if (autoStop && !this.heardSpeech && now - this.startedAt > NO_SPEECH_MS) cb.onAutoStop('no-speech')
    }
    source.connect(this.processor)
    this.processor.connect(this.ctx.destination)
  }

  get hasSpeech() {
    return this.heardSpeech
  }

  /** Encerra a captura e devolve o WAV. */
  async stop(): Promise<ArrayBuffer> {
    const rate = this.ctx?.sampleRate ?? 48_000
    const chunks = this.chunks
    await this.release()
    return encodeWav(downsample(concat(chunks), rate, TARGET_RATE), TARGET_RATE)
  }

  /** Descarta tudo o que foi capturado. */
  async abort(): Promise<void> {
    await this.release()
  }

  private async release() {
    this.stopped = true
    this.chunks = []
    this.processor?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    if (this.ctx && this.ctx.state !== 'closed') await this.ctx.close()
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}

function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const write = (o: number, s: string) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)))
  write(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}
