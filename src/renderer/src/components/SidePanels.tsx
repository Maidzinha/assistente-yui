import { useCallback, useEffect, useState } from 'react'
import type { Settings } from '@shared/types'
import fechada from '../assets/yui/boca-0-fechada.png'
import pequena from '../assets/yui/boca-1-pequena.png'
import media from '../assets/yui/boca-2-media.png'
import aberta from '../assets/yui/boca-3-aberta.png'
import bocaO from '../assets/yui/boca-4-o.png'
import bocaE from '../assets/yui/boca-5-e.png'
import sorriso from '../assets/yui/boca-6-sorriso.png'
import type { VoiceState } from '../hooks/useVoice'
import { api } from '../lib/api'
import { isTalking, mouthLevel } from '../lib/lipsync'
import { Avatar3D } from './Avatar3D'
import { Icon } from './Icon'
import { Button, IconButton, Spinner } from './ui'
import { Waveform } from './Waveform'

type AvatarSettings = Settings['avatar']

export type Presence = 'ready' | 'listening' | 'thinking' | 'speaking' | 'confirming' | 'offline' | 'loading'

const PRESENCE: Record<Presence, string> = {
  ready: 'Pronta',
  listening: 'Ouvindo',
  thinking: 'Pensando',
  speaking: 'Falando',
  confirming: 'Aguardando confirmação',
  offline: 'IA desconectada',
  loading: 'Verificando…'
}

// Ordem dos quadros: 0 quieta, 1 entre palavras, 2 pequena, 3–5 médias, 6 aberta.
const FRAMES = [fechada, sorriso, pequena, media, bocaE, bocaO, aberta]
const MEDIUM = [3, 4, 5]

/** Escolhe a boca a cada ~70 ms conforme o volume da fala. */
function useMouthFrame(speaking: boolean): number {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!speaking) {
      setFrame(0)
      return
    }
    let raf = 0
    let last = 0
    let smooth = 0
    let variant = 0
    const t0 = performance.now()
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < 70) return
      last = now
      if (!isTalking()) {
        // Pensando na próxima frase: boca fechada, sem mexer.
        smooth = 0
        setFrame(1)
        return
      }
      let level = mouthLevel()
      if (level === null) {
        // Sem medição (voz do Windows): imita o ritmo das sílabas.
        const t = (now - t0) / 1000
        level = Math.max(0, 0.55 * Math.sin(t * 12) + 0.3 * Math.sin(t * 4.7 + 1) + 0.15)
      }
      smooth = smooth * 0.35 + level * 0.65
      if (Math.random() < 0.2) variant = Math.floor(Math.random() * MEDIUM.length)
      setFrame(smooth < 0.12 ? 1 : smooth < 0.3 ? 2 : smooth < 0.62 ? MEDIUM[variant] : 6)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [speaking])
  return frame
}

/** Carrega o modelo .vrm importado (quando o modo 3D está ligado). */
function useAvatarModel(avatar: AvatarSettings | undefined) {
  const [model, setModel] = useState<ArrayBuffer | null>(null)
  const want3d = avatar?.mode === '3d' && !!avatar.vrmName
  useEffect(() => {
    if (!want3d || !api) {
      setModel(null)
      return
    }
    let cancelled = false
    api.avatar.load().then((buf) => { if (!cancelled) setModel(buf) }).catch(() => { if (!cancelled) setModel(null) })
    return () => { cancelled = true }
  }, [want3d, avatar?.vrmName])
  return model
}

export function CharacterPanel({ presence, sentence, avatar }: { presence: Presence; sentence?: string | null; avatar?: AvatarSettings }) {
  const model = useAvatarModel(avatar)
  const [failed, setFailed] = useState<string | null>(null)
  const onError = useCallback((msg: string) => setFailed(msg), [])
  useEffect(() => setFailed(null), [model])
  const show3d = !!model && !failed
  const frame = useMouthFrame(presence === 'speaking' && !show3d)
  return (
    <section className={`panel character presence-${presence}`} aria-label="Sua assistente">
      <div className={`portrait ${show3d ? 'is-3d' : ''}`} role="img" aria-label="Yui, assistente em estilo anime com cabelo rosa longo e suéter rosa">
        {show3d ? (
          <Avatar3D model={model} presence={presence} sentence={sentence ?? null} onError={onError} />
        ) : (
          /* Todos os quadros ficam carregados; só o atual aparece, para a troca não piscar. */
          FRAMES.map((src, i) => (
            <img key={src} src={src} alt="" className={i === frame ? 'is-current' : ''} draggable={false} />
          ))
        )}
      </div>
      {failed && <p className="avatar-error" role="alert">{failed} Mostrando o desenho 2D.</p>}
      <div className="character-info">
        <div>
          <h2 className="character-name">Yuri Degurechaff</h2>
          <p className="character-sub">Pode me chamar de <strong>Yui</strong></p>
        </div>
        <span className="presence-pill" role="status">
          <span className="presence-dot" /> {PRESENCE[presence]}
        </span>
      </div>
    </section>
  )
}

const VOICE_LABEL: Record<VoiceState, string> = {
  idle: 'Pronta',
  listening: 'Ouvindo',
  transcribing: 'Pensando',
  thinking: 'Pensando',
  speaking: 'Falando'
}

interface VoiceProps {
  state: VoiceState
  active: boolean
  level: number
  micMuted: boolean
  voiceMuted: boolean
  sttReady: boolean
  statusLoading: boolean
  confirming: boolean
  error: string | null
  notice: string | null
  lastTranscript: string | null
  onPrimary(): void
  onInterrupt(): void
  onEnd(): void
  onToggleMic(): void
  onToggleVoice(): void
  onOpenSettings(): void
  onDismissError(): void
  onStopSpeaking(): void
}

export function VoicePanel(p: VoiceProps) {
  // Fala de uma resposta digitada, fora da conversa por voz.
  const speakingText = !p.active && p.state === 'speaking'
  const label = p.confirming ? 'Aguardando confirmação'
    : speakingText ? 'Falando'
    : !p.sttReady && !p.statusLoading ? 'Microfone indisponível'
    : !p.active ? 'Pronta' : p.micMuted && p.state === 'idle' ? 'Microfone silenciado' : VOICE_LABEL[p.state]
  const animated = speakingText || (p.active && (p.state === 'listening' || p.state === 'speaking'))
  const level = p.state === 'speaking' ? 0.7 : p.level
  const busy = p.state === 'transcribing' || p.state === 'thinking'

  const primaryLabel = !p.active
    ? 'Toque para conversar'
    : p.state === 'listening' ? 'Toque para enviar'
    : p.state === 'speaking' ? 'Toque para interromper'
    : busy ? 'Processando…' : 'Toque para falar'

  return (
    <section className={`panel voice voice-${p.active ? p.state : 'off'}`} aria-label="Conversa por voz">
      <div className="voice-head">
        <h2 className="panel-title">Conversa por voz</h2>
        <span className={`voice-state state-${p.active || speakingText ? p.state : 'idle'}`} role="status" aria-live="polite">
          {busy && <Spinner size={12} />} {label}
        </span>
      </div>

      {speakingText ? (
        <>
          <div className="voice-stage">
            <Waveform level={0.7} bars={11} animated className="wave-side" />
            <button type="button" className="voice-orb is-live" onClick={p.onStopSpeaking} aria-label="Parar a fala">
              <Icon name="stop" size={34} />
            </button>
            <Waveform level={0.7} bars={11} animated className="wave-side" />
          </div>
          <p className="voice-caption">Toque para parar a fala</p>
        </>
      ) : !p.sttReady && !p.statusLoading ? (
        <div className="voice-setup">
          <Icon name="micOff" size={22} />
          <p>O reconhecimento de fala local ainda não está conectado, então você ainda não pode falar com a Yui. Ela continua respondendo em voz às mensagens digitadas, se essa opção estiver ligada.</p>
          <Button variant="secondary" icon="settings" onClick={p.onOpenSettings}>Ver como configurar</Button>
        </div>
      ) : (
        <>
          <div className="voice-stage">
            <Waveform level={level} bars={11} animated={animated} className="wave-side" />
            <button
              type="button"
              className={`voice-orb ${animated ? 'is-live' : ''}`}
              onClick={p.onPrimary}
              disabled={busy || p.statusLoading}
              aria-label={primaryLabel}
            >
              <Icon name={p.active && p.state === 'speaking' ? 'stop' : 'mic'} size={34} />
            </button>
            <Waveform level={level} bars={11} animated={animated} className="wave-side" />
          </div>
          <p className="voice-caption">{primaryLabel}</p>

          {p.active && (
            <div className="voice-controls">
              <IconButton icon={p.micMuted ? 'micOff' : 'mic'} label={p.micMuted ? 'Reativar microfone' : 'Silenciar microfone'} active={p.micMuted} onClick={p.onToggleMic} />
              <IconButton icon={p.voiceMuted ? 'volumeOff' : 'volume'} label={p.voiceMuted ? 'Ativar a voz da Yui' : 'Silenciar a voz da Yui'} active={p.voiceMuted} onClick={p.onToggleVoice} />
              <IconButton icon="stop" label="Interromper a fala" onClick={p.onInterrupt} disabled={p.state !== 'speaking' && p.state !== 'thinking'} />
              <IconButton icon="phoneOff" label="Encerrar conversa por voz" onClick={p.onEnd} className="danger" />
            </div>
          )}
          {p.lastTranscript && p.active && <p className="voice-transcript">Você disse: “{p.lastTranscript}”</p>}
        </>
      )}

      {p.notice && !p.error && <p className="voice-notice">{p.notice}</p>}
      {p.error && (
        <div className="voice-error" role="alert">
          <Icon name="alert" size={16} />
          <span>{p.error}</span>
          <button type="button" className="link-btn" onClick={p.onDismissError}>OK</button>
        </div>
      )}
    </section>
  )
}
