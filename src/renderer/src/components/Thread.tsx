import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import type { ActionRecord, ChatMessage } from '@shared/types'
import { stripVoiceTags } from '@shared/voiceTags'
import type { StreamingTurn } from '../hooks/useChat'
import { api } from '../lib/api'
import { Icon } from './Icon'
import { Button, Spinner } from './ui'

const STATUS_TEXT: Record<ActionRecord['status'], string> = {
  'awaiting-confirmation': 'Aguardando sua confirmação',
  running: 'Em andamento',
  done: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
  denied: 'Não autorizada'
}

export function ActionCard({ action }: { action: ActionRecord }) {
  const live = action.status === 'running' || action.status === 'awaiting-confirmation'
  return (
    <div className={`action-card status-${action.status}`}>
      <div className="action-head">
        {live ? <Spinner /> : <Icon name={action.status === 'done' ? 'check' : action.status === 'failed' ? 'alert' : 'x'} size={16} />}
        <strong>{action.label}</strong>
        <span className="action-status">{STATUS_TEXT[action.status]}</span>
        {live && (
          <Button variant="ghost" className="action-cancel" onClick={() => api?.actions.cancel(action.id)}>Cancelar</Button>
        )}
      </div>
      {action.summary && <p className="action-summary">{action.summary}</p>}
      {action.error && <p className="action-error">{action.error}</p>}
      {action.status === 'done' && action.result && <pre className="action-result">{action.result}</pre>}
    </div>
  )
}

/** Markdown mínimo: **negrito** e `código`. Destaca a frase sendo falada, quando houver. */
function RichText({ text: rawText, highlight: rawHighlight }: { text: string; highlight?: string | null }) {
  // As marcações de emoção da voz ([excited], [chuckles]…) não aparecem na conversa.
  const text = stripVoiceTags(rawText)
  const highlight = rawHighlight ? stripVoiceTags(rawHighlight).trim() : null
  if (highlight) {
    const idx = text.indexOf(highlight)
    if (idx >= 0) {
      return (
        <>
          {inline(text.slice(0, idx))}
          <mark className="spoken">{inline(highlight)}</mark>
          {inline(text.slice(idx + highlight.length))}
        </>
      )
    }
  }
  return <>{inline(text)}</>
}

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    return <Fragment key={i}>{part}</Fragment>
  })
}

function Bubble({ msg, highlight }: { msg: ChatMessage; highlight?: string | null }) {
  const mine = msg.role === 'user'
  return (
    <div className={`bubble-row ${mine ? 'mine' : 'theirs'}`}>
      <div className={`bubble ${msg.error ? 'bubble-error' : ''}`}>
        {msg.source === 'voice' && (
          <span className="bubble-tag"><Icon name="mic" size={12} /> {mine ? 'Transcrição' : 'Resposta falada'}</span>
        )}
        {msg.actions?.map((a) => <ActionCard key={a.id} action={a} />)}
        {msg.content && <div className="bubble-text"><RichText text={msg.content} highlight={highlight} /></div>}
        {msg.error && (
          <div className="bubble-error-text">
            <Icon name="alert" size={16} /> {msg.error}
          </div>
        )}
      </div>
    </div>
  )
}

interface Props {
  messages: ChatMessage[]
  streaming: StreamingTurn | null
  spoken: { turnId: string; sentence: string } | null
  loading: boolean
}

export function Thread({ messages, streaming, spoken, loading }: Props) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, streaming?.text, streaming?.actions.length])

  if (loading) {
    return <div className="thread thread-loading"><Spinner size={24} /> Carregando conversa…</div>
  }

  // A frase falada pode pertencer à última resposta já concluída.
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id

  return (
    <div className="thread" aria-live="polite">
      {messages.map((m) => (
        <Bubble key={m.id} msg={m} highlight={!streaming && m.id === lastAssistantId ? spoken?.sentence : null} />
      ))}
      {streaming && (
        <div className="bubble-row theirs">
          <div className="bubble">
            {streaming.source === 'voice' && <span className="bubble-tag"><Icon name="mic" size={12} /> Resposta falada</span>}
            {streaming.actions.map((a) => <ActionCard key={a.id} action={a} />)}
            {streaming.text ? (
              <div className="bubble-text">
                <RichText text={streaming.text} highlight={spoken?.turnId === streaming.turnId ? spoken.sentence : null} />
                <span className="caret" />
              </div>
            ) : (
              !streaming.actions.some((a) => a.status === 'running' || a.status === 'awaiting-confirmation') && (
                <div className="typing"><span /><span /><span /> <em>Yui está pensando…</em></div>
              )
            )}
          </div>
        </div>
      )}
      <div ref={end} />
    </div>
  )
}
