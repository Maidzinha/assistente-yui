import { useCallback, useEffect, useState } from 'react'
import type { RateLimits, UsageInfo } from '@shared/types'
import { api } from '../lib/api'
import { IconButton } from './ui'

const fmt = (n: number) => n.toLocaleString('pt-BR')
const usd = (n: number) =>
  n < 0.01 && n > 0 ? '< US$ 0,01' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const date = (ms: number) => new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

function Meter({ left, total, label }: { left: number; total: number; label: string }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0
  return (
    <div className="usage-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={left}>
      <div className={`usage-meter-fill ${pct < 15 ? 'is-low' : ''}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function limitLine(l: RateLimits | null, what: string) {
  if (!l || l.requestsLeft === undefined) return null
  return (
    <p className="usage-sub">
      {what}: <strong>{fmt(l.requestsLeft)}</strong>{l.requestsLimit ? ` de ${fmt(l.requestsLimit)}` : ''} pedidos restantes hoje
    </p>
  )
}

/** Créditos da ElevenLabs e limites/gasto da Groq, atualizados depois de cada resposta. */
export function UsagePanel({ refreshKey }: { refreshKey: unknown }) {
  const [info, setInfo] = useState<UsageInfo | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    if (!api) return
    setLoading(true)
    api.usage.get().then(setInfo).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5 * 60_000)
    return () => clearInterval(t)
  }, [load])
  // Atualiza logo depois que a Yui termina de responder ou de falar.
  useEffect(() => {
    const t = setTimeout(load, 1500)
    return () => clearTimeout(t)
  }, [refreshKey, load])

  if (!info || (!info.eleven && !info.groq)) return null
  const { eleven, groq } = info

  return (
    <section className="panel usage" aria-label="Créditos dos serviços">
      <div className="usage-head">
        <h2 className="panel-title">Créditos</h2>
        <IconButton icon="refresh" label="Atualizar créditos" onClick={load} disabled={loading} />
      </div>

      {eleven && (
        <div className="usage-row">
          <div className="usage-title">
            <span>Voz · ElevenLabs</span>
            {eleven.remaining !== undefined && <strong>{fmt(eleven.remaining)}</strong>}
          </div>
          {eleven.error ? <p className="usage-sub is-error">{eleven.error}</p> : eleven.remaining !== undefined && eleven.limit !== undefined && (
            <>
              <Meter left={eleven.remaining} total={eleven.limit} label="Créditos restantes da ElevenLabs" />
              <p className="usage-sub">
                restantes de {fmt(eleven.limit)}{eleven.resetAt ? ` · renova em ${date(eleven.resetAt)}` : ''}
              </p>
            </>
          )}
        </div>
      )}

      {groq && (
        <div className="usage-row">
          <div className="usage-title">
            <span>IA e microfone · Groq</span>
            <strong>{usd(groq.month.costUsd)}</strong>
          </div>
          <p className="usage-sub">gasto estimado neste mês ({fmt(groq.month.tokens)} tokens, {groq.month.audioMinutes.toFixed(1).replace('.', ',')} min de áudio)</p>
          {groq.chat?.requestsLeft !== undefined && groq.chat.requestsLimit ? (
            <Meter left={groq.chat.requestsLeft} total={groq.chat.requestsLimit} label="Pedidos restantes hoje na Groq" />
          ) : null}
          {limitLine(groq.chat, 'Conversa')}
          {limitLine(groq.audio, 'Microfone')}
          {!groq.chat && !groq.audio && <p className="usage-sub">Os limites do dia aparecem depois da primeira mensagem.</p>}
        </div>
      )}
    </section>
  )
}
