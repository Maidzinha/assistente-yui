import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { isLicensed, type LicenseStatus } from '@shared/license'
import { api, errorMessage } from '../lib/api'
import { Icon } from './Icon'
import { Button, Notice, Spinner } from './ui'

/** Acompanha o estado da licença vindo do processo principal. */
export function useLicense() {
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  useEffect(() => {
    if (!api) return
    void api.license.status().then(setStatus)
    return api.license.onChange(setStatus)
  }, [])
  return { status, setStatus }
}

function formatDate(iso?: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function licenseSummary(s: LicenseStatus): string {
  if (s.lifetime) return 'Vitalícia'
  if (s.expiresAt) return `Válida até ${formatDate(s.expiresAt)}`
  return s.statusLabel ?? ''
}

function ActivationScreen({ status, onStatus }: { status: LicenseStatus; onStatus(s: LicenseStatus): void }) {
  const [key, setKey] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!api || busy) return
    setBusy(true)
    setError(null)
    try {
      onStatus(await api.license.activate(key, email || undefined))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const retry = async () => {
    if (!api) return
    setBusy(true)
    setError(null)
    onStatus(await api.license.check().finally(() => setBusy(false)))
  }

  const blocked = status.state === 'invalid' && status.maskedKey
  return (
    <div className="license-screen">
      <form className="license-card" onSubmit={submit}>
        <div className="license-brand">
          <Icon name="logo" size={36} className="brand-icon" />
          <div>
            <h1>Assistente <em>Yui</em></h1>
            <p className="muted">Ative sua licença para conversar com a Yui.</p>
          </div>
        </div>

        {status.state === 'unconfigured' ? (
          <Notice tone="error" title="Licenciamento não configurado">
            <p>{status.message} Crie o arquivo <code>.env.local</code> (veja <code>.env.example</code>) e compile de novo.</p>
          </Notice>
        ) : (
          <>
            {blocked && (
              <Notice
                tone="warning"
                title={`Licença ${status.maskedKey} bloqueada`}
                actions={<Button variant="ghost" icon="refresh" onClick={retry} disabled={busy}>Tentar de novo</Button>}
              >
                <p>{status.message}</p>
              </Notice>
            )}
            <label className="field">
              <span className="field-label">Chave da licença</span>
              <input
                className="license-key-input"
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase())}
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                maxLength={128}
              />
            </label>
            <label className="field">
              <span className="field-label">E-mail da compra (opcional)</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} autoComplete="email" />
              <span className="field-hint">Se a licença foi registrada com um e-mail, informe o mesmo aqui.</span>
            </label>
            {error && <p className="footer-error" role="alert">{error}</p>}
            <Button type="submit" variant="primary" icon={busy ? undefined : 'check'} disabled={busy || key.trim().length < 4}>
              {busy ? <><Spinner /> Ativando…</> : 'Ativar licença'}
            </Button>
            <p className="field-hint">A licença fica vinculada a este computador. Para trocar de PC, use Configurações → Licença → Desativar neste PC.</p>
          </>
        )}
      </form>
    </div>
  )
}

/** Só mostra a Yui quando há uma licença ativa (ou dentro do período sem internet). */
export function LicenseGate({ children }: { children: ReactNode }) {
  const { status, setStatus } = useLicense()
  if (!api) return <>{children}</>
  if (!status) {
    return <div className="license-screen"><div className="status-line"><Spinner /> Conferindo a licença…</div></div>
  }
  if (!isLicensed(status)) return <ActivationScreen status={status} onStatus={setStatus} />
  return <>{children}</>
}

/** Aba “Licença” das Configurações. */
export function LicenseTab() {
  const { status, setStatus } = useLicense()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async (fn: () => Promise<LicenseStatus>) => {
    setBusy(true)
    setErr(null)
    try { setStatus(await fn()) } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false); setConfirm(false) }
  }
  if (!api || !status) return <div className="status-line"><Spinner /> Carregando…</div>
  return (
    <div className="settings-grid">
      {status.state === 'offline' && (
        <Notice tone="warning" title="Sem conexão com o servidor de licenças">
          <p>A Yui funciona sem internet até {formatDate(status.offlineUntil ? new Date(status.offlineUntil).toISOString() : null)}.</p>
        </Notice>
      )}
      <dl className="license-info">
        <dt>Chave</dt><dd><code>{status.maskedKey ?? '—'}</code></dd>
        <dt>Situação</dt><dd>{status.state === 'valid' ? 'Ativa' : status.state === 'offline' ? 'Ativa (sem conexão)' : status.message}</dd>
        {status.owner && <><dt>Titular</dt><dd>{status.owner}</dd></>}
        <dt>Validade</dt><dd>{licenseSummary(status) || '—'}</dd>
        {status.maxActivations != null && <><dt>Computadores</dt><dd>{status.activeDevices} de {status.maxActivations}</dd></>}
        {status.lastCheckAt && <><dt>Última verificação</dt><dd>{formatDate(new Date(status.lastCheckAt).toISOString())}</dd></>}
      </dl>
      {err && <p className="footer-error">{err}</p>}
      <div className="inline-row">
        <Button variant="ghost" icon="refresh" disabled={busy} onClick={() => run(() => api!.license.check())}>Verificar agora</Button>
        {confirm ? (
          <>
            <span className="field-hint">Liberar este PC? A Yui vai pedir a chave de novo.</span>
            <Button variant="primary" disabled={busy} onClick={() => run(() => api!.license.deactivate())}>Sim, desativar</Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancelar</Button>
          </>
        ) : (
          <Button variant="ghost" disabled={busy} onClick={() => setConfirm(true)}>Desativar neste PC</Button>
        )}
      </div>
    </div>
  )
}
