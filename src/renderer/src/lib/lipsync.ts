/**
 * Mede o volume da fala da Yui enquanto o áudio toca, para a boca acompanhar a voz.
 * As vozes do Windows (speechSynthesis) não passam pelo áudio da página; nesse caso
 * mouthLevel() devolve null e a animação usa um ritmo de sílabas.
 */
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let live = false
let peak = 0.05
const buf = new Float32Array(1024)

/** Liga um elemento de áudio ao medidor. Chame antes de play(). */
export async function attachAudio(el: HTMLAudioElement): Promise<void> {
  try {
    if (!ctx) {
      ctx = new AudioContext()
      analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.connect(ctx.destination)
    }
    if (ctx.state !== 'running') await ctx.resume()
    // Se o áudio da página estiver suspenso, não desvia o som (ficaria mudo).
    if (ctx.state !== 'running' || !analyser) return
    ctx.createMediaElementSource(el).connect(analyser)
    live = true
  } catch {
    live = false
  }
}

export function detachAudio(): void {
  live = false
}

/** Há som da Yui saindo agora (áudio medido ou voz do Windows)? */
export function isTalking(): boolean {
  return live || window.speechSynthesis.speaking
}

/** Abertura da boca de 0 a 1, ou null quando não há como medir. */
export function mouthLevel(): number | null {
  if (!analyser || !live) return null
  analyser.getFloatTimeDomainData(buf)
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  const rms = Math.sqrt(sum / buf.length)
  // Normaliza pelo pico recente, que vai baixando devagar.
  peak = Math.max(rms, peak * 0.995, 0.02)
  return Math.min(1, rms / peak)
}
