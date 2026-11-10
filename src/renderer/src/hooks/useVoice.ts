import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatEvent, MessageSource, MicMode, ProvidersStatus, Settings } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { MicRecorder } from '../lib/recorder'
import { Speaker } from '../lib/speaker'

export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

const CONSENT_KEY = 'assistente.mic-consent'

/** Teclas oferecidas para o "apertar para falar" (nenhuma atrapalha a digitação). */
export const PUSH_KEYS: Record<string, string> = {
  F2: 'F2',
  F4: 'F4',
  F8: 'F8',
  F9: 'F9',
  ControlRight: 'Ctrl direito',
  Insert: 'Insert',
  Pause: 'Pause'
}
export const pushKeyLabel = (code: string | undefined) => PUSH_KEYS[code ?? ''] ?? 'F2'

interface Options {
  settings: Settings | null
  status: ProvidersStatus | null
  send(text: string, source: MessageSource): Promise<string | null>
  cancelTurn(): void
  subscribe(listener: (e: ChatEvent) => void): () => void
}

function micErrorMessage(err: unknown): string {
  const name = (err as DOMException)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Permissão do microfone negada. No Windows, abra Configurações → Privacidade e segurança → Microfone e permita o acesso para aplicativos da área de trabalho.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Nenhum microfone foi encontrado. Conecte um microfone e tente de novo.'
  if (name === 'NotReadableError') return 'O microfone está em uso por outro aplicativo ou indisponível.'
  return `Não foi possível acessar o microfone: ${errorMessage(err)}`
}

/**
 * Conversa por voz de ponta a ponta:
 * microfone → transcrição local → mesma IA e mesmo histórico do chat → resposta falada.
 */
export function useVoice(opts: Options) {
  const [state, setState] = useState<VoiceState>('idle')
  const [active, setActive] = useState(false)
  const [micMuted, setMicMuted] = useState(false)
  const [voiceMuted, setVoiceMuted] = useState(false)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [lastTranscript, setLastTranscript] = useState<string | null>(null)
  const [spoken, setSpoken] = useState<{ turnId: string; sentence: string } | null>(null)
  const [consentNeeded, setConsentNeeded] = useState(false)

  const o = useRef(opts)
  o.current = opts
  const activeRef = useRef(false)
  const micMutedRef = useRef(false)
  const voiceMutedRef = useRef(false)
  const recorderRef = useRef<MicRecorder | null>(null)
  const speakerRef = useRef<Speaker | null>(null)
  const turnRef = useRef<string | null>(null)
  const turnDoneRef = useRef(false)
  const stateRef = useRef<VoiceState>('idle')
  stateRef.current = state
  // Apertar para falar: se a tecla está pressionada, e se a gravação atual começou por ela.
  const pushHeldRef = useRef(false)
  const keyDrivenRef = useRef(false)
  const mode: MicMode = opts.settings?.voice.micMode ?? 'tap'
  // Funções mais recentes, para callbacks do gravador criados em renderizações anteriores.
  const fns = useRef({
    finishListening: async () => {},
    giveUp: async (_rec: MicRecorder) => {},
    endSession: () => {}
  })

  const sttReady = opts.status?.stt.ok === true
  const ttsReady = opts.status?.tts.ok === true && opts.settings?.tts.provider !== 'none'

  const listen = useCallback(async () => {
    if (!activeRef.current || micMutedRef.current) {
      setState('idle')
      return
    }
    const v = o.current.settings?.voice
    const micMode: MicMode = v?.micMode ?? 'tap'
    const rec = new MicRecorder()
    recorderRef.current = rec
    setState('listening')
    setError(null)
    setNotice(null)
    try {
      await rec.start(
        {
          onLevel: (l) => setLevel(l),
          onAutoStop: (reason) => {
            if (reason === 'no-speech') void fns.current.giveUp(rec)
            else void fns.current.finishListening()
          }
        },
        {
          autoStop: micMode === 'open' ? true : micMode === 'push' ? false : v?.autoStopOnSilence ?? true,
          waitForSpeech: micMode === 'open',
          sensitivity: v?.micSensitivity ?? 5,
          silenceMs: (v?.silenceSeconds ?? 1.3) * 1000
        }
      )
      // A tecla foi solta antes de o microfone abrir: encerra em silêncio.
      if (micMode === 'push' && keyDrivenRef.current && !pushHeldRef.current && recorderRef.current === rec) {
        void fns.current.finishListening()
      }
    } catch (err) {
      recorderRef.current = null
      await rec.abort()
      setError(micErrorMessage(err))
      fns.current.endSession()
    }
  }, [])

  const giveUp = async (rec: MicRecorder) => {
    if (recorderRef.current !== rec && recorderRef.current !== null) return
    recorderRef.current = null
    await rec.abort()
    setLevel(0)
    if ((o.current.settings?.voice.micMode ?? 'tap') === 'push') {
      // No apertar para falar a conversa continua ligada, só esperando a tecla.
      setNotice('Não ouvi nada. Segure a tecla enquanto fala e solte para enviar.')
      setState('idle')
      return
    }
    setNotice('Não ouvi nada, então pausei o microfone. Toque para falar de novo.')
    activeRef.current = false
    setActive(false)
    setState('idle')
  }

  const afterReply = useCallback(() => {
    speakerRef.current = null
    turnRef.current = null
    setSpoken(null)
    const v = o.current.settings?.voice
    const micMode: MicMode = v?.micMode ?? 'tap'
    // Microfone livre sempre volta a ouvir; apertar para falar espera a tecla.
    const again = micMode === 'open' || (micMode === 'tap' && v?.continuousConversation)
    if (activeRef.current && again && !micMutedRef.current) void listen()
    else setState('idle')
  }, [listen])

  /** Liga a fala à resposta desta rodada, se houver voz configurada e não silenciada. */
  const attachSpeaker = useCallback((turnId: string): boolean => {
    const settings = o.current.settings
    const ttsOk = o.current.status?.tts.ok === true && settings?.tts.provider !== 'none'
    if (!settings || !ttsOk || voiceMutedRef.current) return false
    const speaker: Speaker = new Speaker(settings, {
      onSentence: (raw) => {
        if (speakerRef.current !== speaker) return
        if (raw) {
          setState('speaking')
          setSpoken({ turnId, sentence: raw })
        } else setSpoken(null)
      },
      onIdle: () => {
        if (speakerRef.current === speaker) afterReply()
      },
      onError: (msg) => setError(`Falha na voz: ${msg}`)
    })
    speakerRef.current = speaker
    return true
  }, [afterReply])

  /** Lê em voz alta a resposta de uma mensagem digitada (fora da conversa por voz). */
  const speakTurn = useCallback((turnId: string) => {
    if (activeRef.current) return
    speakerRef.current?.stop()
    speakerRef.current = null
    turnRef.current = turnId
    turnDoneRef.current = false
    if (!attachSpeaker(turnId)) turnRef.current = null
  }, [attachSpeaker])

  const finishListening = useCallback(async () => {
    const rec = recorderRef.current
    if (!rec || !api) return
    recorderRef.current = null
    setLevel(0)
    if (!rec.hasSpeech) {
      await giveUp(rec)
      return
    }
    const wav = await rec.stop()
    setState('transcribing')
    try {
      const language = o.current.settings?.voice.language ?? 'pt-BR'
      const { text } = await api.voice.transcribe(wav, language)
      if (!activeRef.current) return
      if (!text) {
        setNotice('Não consegui entender. Pode repetir?')
        if ((o.current.settings?.voice.micMode ?? 'tap') === 'push') setState('idle')
        else void listen()
        return
      }
      setLastTranscript(text)
      setState('thinking')

      const speak = o.current.settings?.voice.spokenReplies
      const turnId = await o.current.send(text, 'voice')
      if (!turnId) {
        setError('Não foi possível enviar a mensagem para a IA.')
        setState('idle')
        return
      }
      turnRef.current = turnId
      turnDoneRef.current = false
      if (speak) attachSpeaker(turnId)
    } catch (err) {
      setError(`Falha na transcrição: ${errorMessage(err)}`)
      setState('idle')
      activeRef.current = false
      setActive(false)
    }
  }, [listen, attachSpeaker])

  // Recebe a resposta da IA (a mesma usada no chat) e alimenta a fala frase a frase.
  useEffect(() => {
    return opts.subscribe((event) => {
      if (event.turnId !== turnRef.current) return
      const speaker = speakerRef.current
      if (event.type === 'delta') speaker?.feed(event.text)
      else if (event.type === 'done' || event.type === 'error') {
        turnDoneRef.current = true
        if (event.type === 'error') setError(event.message.error ?? 'A IA não conseguiu responder.')
        if (speaker && event.type === 'done') speaker.end()
        else {
          speaker?.stop()
          afterReply()
        }
      }
    })
  }, [opts.subscribe, afterReply])

  const endSession = useCallback(() => {
    activeRef.current = false
    setActive(false)
    const rec = recorderRef.current
    recorderRef.current = null
    void rec?.abort()
    speakerRef.current?.stop()
    speakerRef.current = null
    turnRef.current = null
    setSpoken(null)
    setLevel(0)
    setState('idle')
  }, [])

  const start = useCallback(() => {
    setError(null)
    setNotice(null)
    if (!api) {
      setError('A ponte com o sistema não está disponível.')
      return
    }
    if (!sttReady) {
      setError('O reconhecimento de fala ainda não está configurado. Veja as instruções em Configurações → Voz.')
      return
    }
    let consent: string | null = null
    try { consent = localStorage.getItem(CONSENT_KEY) } catch { /* armazenamento indisponível */ }
    if (consent !== '1') {
      setConsentNeeded(true)
      return
    }
    activeRef.current = true
    setActive(true)
    void listen()
  }, [sttReady, listen])

  const acceptConsent = useCallback(() => {
    try { localStorage.setItem(CONSENT_KEY, '1') } catch { /* segue sem lembrar */ }
    setConsentNeeded(false)
    activeRef.current = true
    setActive(true)
    void listen()
  }, [listen])

  /** Interrompe a fala (e a geração, se ainda estiver em andamento) e volta a ouvir. */
  const interrupt = useCallback(() => {
    const speaker = speakerRef.current
    speakerRef.current = null
    speaker?.stop()
    if (turnRef.current && !turnDoneRef.current) o.current.cancelTurn()
    turnRef.current = null
    setSpoken(null)
    const micMode = o.current.settings?.voice.micMode ?? 'tap'
    const again = micMode !== 'push' || pushHeldRef.current
    if (activeRef.current && !micMutedRef.current && again) void listen()
    else setState('idle')
  }, [listen])

  const toggleMic = useCallback(() => {
    const next = !micMutedRef.current
    micMutedRef.current = next
    setMicMuted(next)
    if (next && recorderRef.current) {
      void recorderRef.current.abort()
      recorderRef.current = null
      setLevel(0)
      setState('idle')
    } else if (!next && activeRef.current && !recorderRef.current && !turnRef.current) {
      void listen()
    }
  }, [listen])

  const toggleVoice = useCallback(() => {
    const next = !voiceMutedRef.current
    voiceMutedRef.current = next
    setVoiceMuted(next)
    if (next && speakerRef.current) {
      const speaker = speakerRef.current
      speakerRef.current = null
      speaker.stop()
      setSpoken(null)
      if (turnDoneRef.current) afterReply()
      else setState('thinking')
    }
  }, [afterReply])

  /** Botão principal: começa, envia o que foi dito ou interrompe a fala. */
  const primary = useCallback(() => {
    keyDrivenRef.current = false
    if (!activeRef.current) start()
    else if (recorderRef.current) void finishListening()
    else if (state === 'speaking') interrupt()
    else if (state === 'idle') void listen()
  }, [start, finishListening, interrupt, listen, state])

  fns.current = { finishListening, giveUp, endSession }

  // Apertar para falar: grava enquanto a tecla escolhida estiver pressionada (com a janela em foco).
  const pushKey = opts.settings?.voice.pushKey ?? 'F2'
  useEffect(() => {
    if (mode !== 'push') return
    const release = () => {
      if (!pushHeldRef.current) return
      pushHeldRef.current = false
      if (recorderRef.current && keyDrivenRef.current) void fns.current.finishListening()
    }
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== pushKey) return
      e.preventDefault()
      if (e.repeat || pushHeldRef.current) return
      const st = stateRef.current
      if (recorderRef.current || st === 'transcribing') return
      pushHeldRef.current = true
      keyDrivenRef.current = true
      if (!activeRef.current) start()
      else if (st === 'speaking' || st === 'thinking') interrupt()
      else void listen()
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== pushKey) return
      e.preventDefault()
      release()
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', release)
      pushHeldRef.current = false
    }
  }, [mode, pushKey, start, interrupt, listen])

  useEffect(() => () => endSession(), [endSession])

  return {
    state, active, micMuted, voiceMuted, level, error, notice, lastTranscript, spoken, mode,
    sttReady, ttsReady, consentNeeded,
    start, primary, interrupt, endSession, toggleMic, toggleVoice, acceptConsent, speakTurn,
    /** Para só a fala atual, sem cancelar a resposta em texto. */
    stopSpeaking: () => {
      const speaker = speakerRef.current
      speakerRef.current = null
      speaker?.stop()
      if (!activeRef.current) {
        turnRef.current = null
        setSpoken(null)
        setState('idle')
      }
    },
    declineConsent: () => setConsentNeeded(false),
    dismissError: () => setError(null)
  }
}
