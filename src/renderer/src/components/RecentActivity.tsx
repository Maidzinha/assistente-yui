import type { ConversationSummary } from '@shared/types'
import { Icon } from './Icon'
import { Button } from './ui'

function formatWhen(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `Hoje, ${time}`
  if (d.toDateString() === yesterday.toDateString()) return `Ontem, ${time}`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

interface Props {
  items: ConversationSummary[] | null
  error: string | null
  activeId: string | null
  onOpen(id: string): void
  onRemove(id: string): void
  onRetry(): void
  limit?: number
}

export function RecentActivity({ items, error, activeId, onOpen, onRemove, onRetry, limit = 5 }: Props) {
  if (error) {
    return (
      <div className="list-card state-card">
        <Icon name="alert" size={20} />
        <span>Não foi possível carregar o histórico: {error}</span>
        <Button variant="ghost" icon="refresh" onClick={onRetry}>Tentar de novo</Button>
      </div>
    )
  }
  if (!items) {
    return (
      <div className="list-card" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="list-row skeleton-row"><span className="skeleton" /><span className="skeleton short" /></div>
        ))}
      </div>
    )
  }
  if (!items.length) {
    return (
      <div className="list-card state-card empty">
        <Icon name="chat" size={20} />
        <span>Nenhuma conversa ainda. Escreva ou fale algo para começar.</span>
      </div>
    )
  }
  return (
    <ul className="list-card">
      {items.slice(0, limit).map((c) => (
        <li key={c.id} className={`list-row ${c.id === activeId ? 'is-current' : ''}`}>
          <button type="button" className="list-row-main" onClick={() => onOpen(c.id)}>
            <Icon name={c.lastSource === 'voice' ? 'mic' : 'file'} size={22} className="row-icon" />
            <span className="list-title">{c.title}</span>
            <span className="list-meta">{formatWhen(c.updatedAt)}</span>
          </button>
          <button type="button" className="list-remove" aria-label={`Apagar a conversa ${c.title}`} title="Apagar do histórico" onClick={() => onRemove(c.id)}>
            <Icon name="trash" size={16} />
          </button>
        </li>
      ))}
    </ul>
  )
}
