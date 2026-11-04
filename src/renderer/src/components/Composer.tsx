import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react'
import type { VoiceState } from '../hooks/useVoice'
import { Icon } from './Icon'
import { Waveform } from './Waveform'

export interface ComposerHandle {
  prefill(text: string): void
}

interface Props {
  busy: boolean
  disabled?: boolean
  voiceActive: boolean
  voiceState: VoiceState
  level: number
  onSend(text: string): void
  onCancel(): void
  onMic(): void
  compact?: boolean
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { busy, disabled, voiceActive, voiceState, level, onSend, onCancel, onMic, compact }, ref
) {
  const [text, setText] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(ref, () => ({
    prefill(value: string) {
      setText(value)
      requestAnimationFrame(() => {
        area.current?.focus()
        area.current?.setSelectionRange(value.length, value.length)
      })
    }
  }))

  const submit = () => {
    const t = text.trim()
    if (!t || busy || disabled) return
    onSend(t)
    setText('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const listening = voiceActive && voiceState === 'listening'
  const micLabel = !voiceActive ? 'Falar com a Yui' : listening ? 'Parar e enviar o que eu disse' : 'Conversa por voz ativa'

  return (
    <div className={`composer ${compact ? 'composer-compact' : ''}`}>
      <label className="sr-only" htmlFor="composer-input">Mensagem</label>
      <textarea
        id="composer-input"
        ref={area}
        value={text}
        rows={compact ? 1 : 3}
        placeholder={listening ? 'Ouvindo… fale normalmente' : 'Escreva uma pergunta ou peça uma tarefa…'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
      />
      <div className="composer-bar">
        <span className="composer-hint">Enter envia · Shift+Enter quebra linha</span>
        <div className="composer-actions">
          <button
            type="button"
            className={`mic-pill ${listening ? 'is-listening' : ''} ${voiceActive ? 'is-active' : ''}`}
            onClick={onMic}
            aria-label={micLabel}
            title={micLabel}
            disabled={disabled}
          >
            <Icon name="mic" size={20} />
            <Waveform level={listening ? level : 0} bars={5} animated={listening} />
          </button>
          {busy ? (
            <button type="button" className="send-btn" onClick={onCancel} aria-label="Parar resposta" title="Parar resposta">
              <Icon name="stop" size={20} />
            </button>
          ) : (
            <button
              type="button"
              className="send-btn"
              onClick={submit}
              disabled={!text.trim() || disabled}
              aria-label="Enviar"
              title="Enviar"
            >
              <Icon name="send" size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
