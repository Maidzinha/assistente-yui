import { useEffect, useState, type ReactNode } from 'react'
import type { MemoryItem, ProviderStatus, ProvidersStatus, SecretKey, SecretsInfo, Settings } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { PUSH_KEYS } from '../hooks/useVoice'
import { listSystemVoices } from '../lib/speaker'
import { Icon } from './Icon'
import { Button, Modal, Spinner } from './ui'

type Tab = 'ia' | 'voz' | 'microfone' | 'aparencia' | 'memoria' | 'privacidade'

const MIC_MODES: { id: Settings['voice']['micMode']; label: string; text: string }[] = [
  { id: 'tap', label: 'Tocar para falar', text: 'Você toca no microfone para começar. A Yui envia quando você para de falar.' },
  { id: 'open', label: 'Microfone livre', text: 'Depois de ligado, fica sempre ouvindo: é só falar, sem tocar em nada. Ela responde e volta a ouvir.' },
  { id: 'push', label: 'Apertar para falar', text: 'Grava só enquanto você segura uma tecla. Bom para ambientes com barulho.' }
]

/** Escolha entre o desenho 2D e o modelo 3D (.vrm) da Yui. */
function AppearanceTab({ avatar, onChange }: { avatar: Settings['avatar']; onChange(a: Settings['avatar']): Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setErr(null)
    try { await fn() } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false) }
  }
  const pick = () => run(async () => {
    const name = await api?.avatar.pick()
    if (name) await onChange({ mode: '3d', vrmName: name })
  })
  const remove = () => run(async () => {
    await api?.avatar.remove()
    await onChange({ ...avatar, vrmName: '' })
  })
  return (
    <div className="settings-grid">
      <Field label="Como a Yui aparece">
        <select value={avatar.mode} onChange={(e) => void onChange({ ...avatar, mode: e.target.value as Settings['avatar']['mode'] })} disabled={busy}>
          <option value="3d">Modelo 3D (quando houver um modelo importado)</option>
          <option value="2d">Desenho 2D com a boca animada</option>
        </select>
      </Field>
      <Field
        label="Modelo 3D (.vrm)"
        hint={avatar.vrmName ? 'O arquivo foi copiado para a pasta do app.' : 'Crie a Yui no VRoid Studio (gratuito) e exporte como VRM. Até lá, aparece o desenho 2D.'}
      >
        <div className="inline-row">
          <input value={avatar.vrmName || 'Nenhum modelo importado'} readOnly />
          <Button onClick={pick} disabled={busy}>{busy ? 'Importando…' : avatar.vrmName ? 'Trocar' : 'Importar .vrm'}</Button>
          {avatar.vrmName && <Button variant="ghost" onClick={remove} disabled={busy}>Remover</Button>}
        </div>
      </Field>
      {err && <p className="footer-error">{err}</p>}
      <p className="field-hint">
        No 3D, a boca acompanha a voz, ela pisca, respira, mexe a cabeça e muda de expressão conforme a emoção da frase
        (feliz, brava, triste, calma e surpresa).
      </p>
    </div>
  )
}

/** Lista do que a Yui lembra, com opção de apagar item por item ou tudo. */
function MemoryTab() {
  const [items, setItems] = useState<MemoryItem[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const load = () => api?.memory.list().then(setItems).catch((e) => setErr(errorMessage(e)))
  useEffect(() => { void load() }, [])
  const remove = async (id: string) => {
    await api?.memory.remove(id).catch((e) => setErr(errorMessage(e)))
    void load()
  }
  const clear = async () => {
    await api?.memory.clear().catch((e) => setErr(errorMessage(e)))
    setConfirmClear(false)
    void load()
  }
  return (
    <div className="settings-grid">
      <p className="field-hint">
        A Yui guarda aqui o que aprende sobre você nas conversas, como seu apelido e seus gostos, e lembra disso nas próximas.
        Fica só neste PC. Você também pode pedir para ela: “Yui, esquece que…”.
      </p>
      {err && <p className="footer-error">{err}</p>}
      {!items ? <div className="status-line"><Spinner /> Carregando…</div>
        : !items.length ? <p className="muted">Ela ainda não guardou nada. Conte algo sobre você numa conversa!</p>
        : (
          <ul className="memory-list">
            {items.map((m) => (
              <li key={m.id} className="memory-item">
                <span>{m.text}</span>
                <Button variant="ghost" onClick={() => remove(m.id)}>Apagar</Button>
              </li>
            ))}
          </ul>
        )}
      {!!items?.length && (
        <div className="inline-row">
          {confirmClear ? (
            <>
              <span className="field-hint">Apagar todas as {items.length} lembranças? Não dá para desfazer.</span>
              <Button variant="primary" onClick={clear}>Sim, apagar tudo</Button>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancelar</Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmClear(true)}>Apagar toda a memória</Button>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function StatusLine({ title, status, checking }: { title: string; status?: ProviderStatus; checking: boolean }) {
  if (checking && !status) return <div className="status-line"><Spinner /> Verificando {title.toLowerCase()}…</div>
  if (!status) return null
  return (
    <div className={`status-line ${status.ok ? 'ok' : 'bad'}`}>
      <div className="status-line-head">
        <Icon name={status.ok ? 'check' : 'alert'} size={16} />
        <strong>{title}:</strong> <span>{status.message}</span>
      </div>
      {!status.ok && status.hint && (
        <ol className="status-hint">{status.hint.map((h) => <li key={h}>{h}</li>)}</ol>
      )}
    </div>
  )
}

function SecretField({ label, secretKey, info, onChanged }: {
  label: string; secretKey: SecretKey; info: SecretsInfo | null; onChanged(): void
}) {
  const [value, setValue] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const saved = info?.[secretKey]
  const save = async (v: string | null) => {
    try {
      await api?.settings.setSecret(secretKey, v)
      setValue('')
      setErr(null)
      onChanged()
    } catch (e) {
      setErr(errorMessage(e))
    }
  }
  return (
    <Field
      label={label}
      hint={err ?? (saved ? 'Chave salva com a criptografia do Windows.' : 'Opcional. Servidores locais normalmente não pedem chave.')}
    >
      <div className="inline-row">
        <input type="password" value={value} placeholder={saved ? '•••••••• (salva)' : 'Nenhuma'} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
        <Button onClick={() => save(value)} disabled={!value}>Salvar</Button>
        {saved && <Button variant="ghost" onClick={() => save(null)}>Remover</Button>}
      </div>
    </Field>
  )
}

interface Props {
  settings: Settings
  status: ProvidersStatus | null
  checking: boolean
  initialTab?: Tab
  onSave(s: Settings): Promise<void>
  onRecheck(): void
  onClose(): void
}

export function SettingsDialog({ settings, status, checking, initialTab = 'ia', onSave, onRecheck, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [draft, setDraft] = useState<Settings>(settings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [secrets, setSecrets] = useState<SecretsInfo | null>(null)

  const fetchSecrets = () => api?.settings.secretsInfo().then(setSecrets).catch(() => setSecrets(null))
  // Uma chave nova muda o estado das conexões, então verifica de novo na hora.
  const loadSecrets = () => {
    void fetchSecrets()
    onRecheck()
  }
  useEffect(() => {
    void fetchSecrets()
    void listSystemVoices().then(setVoices)
  }, [])

  const set = <K extends keyof Settings>(group: K, patch: Partial<Settings[K]>) =>
    setDraft((d) => ({ ...d, [group]: { ...d[group], ...patch } }))

  const setCustom = (patch: Partial<Settings['tts']['custom']>) =>
    setDraft((d) => ({ ...d, tts: { ...d.tts, custom: { ...d.tts.custom, ...patch } } }))

  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const testVoice = async () => {
    if (!api) return
    setTesting(true)
    setTestMsg(null)
    try {
      const phrase = draft.voice.language === 'en-US' ? "Hi! I'm Yui. How can I help?" : 'Oi! Eu sou a Yui. Como posso te ajudar hoje?'
      const { audio, mimeType } = await api.voice.synthesize(phrase)
      const url = URL.createObjectURL(new Blob([audio], { type: mimeType }))
      const el = new Audio(url)
      el.onended = () => URL.revokeObjectURL(url)
      await el.play()
      setTestMsg('Tocando a voz.')
      onRecheck()
    } catch (err) {
      setTestMsg(`Falhou: ${errorMessage(err)}`)
    } finally {
      setTesting(false)
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const langVoices = voices.filter((v) => v.lang.replace('_', '-').startsWith(draft.voice.language.slice(0, 2)))
  const preview = () => {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(draft.voice.language === 'en-US' ? "Hi! I'm Yui." : 'Oi! Eu sou a Yui. Como posso ajudar?')
    u.lang = draft.voice.language
    u.voice = voices.find((v) => v.name === draft.tts.voice) ?? langVoices[0] ?? null
    u.rate = draft.tts.rate
    window.speechSynthesis.speak(u)
  }

  return (
    <Modal
      title="Configurações"
      wide
      onClose={onClose}
      footer={
        <>
          {error && <span className="footer-error">{error}</span>}
          <Button variant="ghost" icon="refresh" onClick={onRecheck} disabled={checking}>Verificar conexões</Button>
          <Button variant="primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
        </>
      }
    >
      <div className="tabs" role="tablist">
        {([['ia', 'Modelo de IA'], ['voz', 'Voz'], ['microfone', 'Microfone'], ['aparencia', 'Aparência'], ['memoria', 'Memória'], ['privacidade', 'Privacidade e ações']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'is-selected' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'ia' && (
        <div className="settings-grid">
          <StatusLine title="IA local" status={status?.llm} checking={checking} />
          <Field label="Provedor">
            <select value={draft.llm.provider} onChange={(e) => {
              const provider = e.target.value as Settings['llm']['provider']
              set('llm', { provider, baseUrl: provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234/v1' })
            }}>
              <option value="ollama">Ollama (recomendado)</option>
              <option value="openai-compatible">Servidor compatível com OpenAI (LM Studio, llama.cpp)</option>
            </select>
          </Field>
          <Field label="Endereço do servidor">
            <input value={draft.llm.baseUrl} onChange={(e) => set('llm', { baseUrl: e.target.value })} />
          </Field>
          <Field label="Modelo" hint="Use um modelo com suporte a ferramentas (tools) para controlar o PC, por exemplo qwen2.5:7b ou llama3.1:8b.">
            <input value={draft.llm.model} onChange={(e) => set('llm', { model: e.target.value })} />
          </Field>
          <Field label={`Criatividade (temperatura): ${draft.llm.temperature.toFixed(1)}`}>
            <input type="range" min={0} max={1.2} step={0.1} value={draft.llm.temperature} onChange={(e) => set('llm', { temperature: Number(e.target.value) })} />
          </Field>
          {draft.llm.provider === 'openai-compatible' && (
            <SecretField label="Chave de API (opcional)" secretKey="llmApiKey" info={secrets} onChanged={loadSecrets} />
          )}
        </div>
      )}

      {tab === 'voz' && (
        <div className="settings-grid">
          <StatusLine title="Reconhecimento de fala" status={status?.stt} checking={checking} />
          <StatusLine title="Voz da assistente" status={status?.tts} checking={checking} />

          <Field label="Idioma da conversa">
            <select value={draft.voice.language} onChange={(e) => set('voice', { language: e.target.value as Settings['voice']['language'] })}>
              <option value="pt-BR">Português (Brasil)</option>
              <option value="en-US">Inglês (EUA)</option>
            </select>
          </Field>

          <h3 className="settings-sub">Reconhecimento de fala</h3>
          <Field label="Provedor">
            <select value={draft.stt.provider} onChange={(e) => {
              const provider = e.target.value as Settings['stt']['provider']
              set('stt', { provider, baseUrl: provider === 'openai-compatible' ? 'http://127.0.0.1:8000/v1' : 'http://127.0.0.1:8080' })
            }}>
              <option value="local-whisper">Whisper local (iniciado pelo app)</option>
              <option value="whisper-cpp">whisper.cpp (whisper-server)</option>
              <option value="openai-compatible">Servidor compatível com OpenAI (Speaches, faster-whisper)</option>
              <option value="none">Desativado</option>
            </select>
          </Field>
          {draft.stt.provider === 'local-whisper' && (
            <>
              <Field label="Python com faster-whisper (python.exe)">
                <input value={draft.stt.whisperPython} placeholder="C:\…\whisper\.venv\Scripts\python.exe"
                  onChange={(e) => set('stt', { whisperPython: e.target.value })} />
              </Field>
              <Field label="Modelo">
                <select value={draft.stt.whisperModel} onChange={(e) => set('stt', { whisperModel: e.target.value })}>
                  <option value="base">base (mais rápido)</option>
                  <option value="small">small (equilibrado)</option>
                  <option value="medium">medium (mais preciso)</option>
                  <option value="large-v3-turbo">large-v3-turbo (precisa de placa de vídeo)</option>
                </select>
              </Field>
              <Field label="Processar em">
                <select value={draft.stt.whisperDevice} onChange={(e) => set('stt', { whisperDevice: e.target.value as 'cpu' | 'cuda' })}>
                  <option value="cpu">Processador (deixa a placa de vídeo livre)</option>
                  <option value="cuda">Placa de vídeo (NVIDIA)</option>
                </select>
              </Field>
            </>
          )}
          {(draft.stt.provider === 'whisper-cpp' || draft.stt.provider === 'openai-compatible') && (
            <Field label="Endereço do servidor">
              <input value={draft.stt.baseUrl} onChange={(e) => set('stt', { baseUrl: e.target.value })} />
            </Field>
          )}
          {draft.stt.provider === 'openai-compatible' && (
            <>
              <Field label="Modelo de transcrição" hint="Na Groq: endereço https://api.groq.com/openai/v1 e modelo whisper-large-v3-turbo.">
                <input value={draft.stt.model} onChange={(e) => set('stt', { model: e.target.value })} />
              </Field>
              <SecretField label="Chave de API (opcional)" secretKey="sttApiKey" info={secrets} onChanged={loadSecrets} />
            </>
          )}

          <h3 className="settings-sub">Voz da Yui</h3>
          <label className="check">
            <input type="checkbox" checked={draft.voice.spokenReplies} onChange={(e) => set('voice', { spokenReplies: e.target.checked })} />
            Responder em voz nas conversas por voz
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.voice.speakTextReplies} onChange={(e) => set('voice', { speakTextReplies: e.target.checked })} />
            Ler em voz alta também as respostas das mensagens digitadas
          </label>
          <Field label="Provedor de voz">
            <select value={draft.tts.provider} onChange={(e) => set('tts', { provider: e.target.value as Settings['tts']['provider'] })}>
              <option value="custom-voice">Voz personalizada (XTTS + RVC, offline)</option>
              <option value="elevenlabs">ElevenLabs (voz clonada, na nuvem)</option>
              <option value="fish-audio">Fish Audio (voz clonada, na nuvem)</option>
              <option value="system">Vozes do Windows (offline)</option>
              <option value="piper">Piper (neural, offline)</option>
              <option value="openai-compatible">Servidor compatível com OpenAI (Kokoro-FastAPI)</option>
              <option value="none">Desativado</option>
            </select>
          </Field>
          {draft.tts.provider === 'system' && (
            <Field label="Voz" hint={langVoices.length ? undefined : 'Nenhuma voz desse idioma instalada. Adicione em Configurações do Windows → Hora e idioma → Fala.'}>
              <div className="inline-row">
                <select value={draft.tts.voice} onChange={(e) => set('tts', { voice: e.target.value })}>
                  <option value="">Automática ({draft.voice.language})</option>
                  {langVoices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                </select>
                <Button icon="volume" onClick={preview}>Ouvir</Button>
              </div>
            </Field>
          )}
          {draft.tts.provider === 'custom-voice' && (
            <>
              <Field label="Nome da voz">
                <input value={draft.tts.custom.name} onChange={(e) => setCustom({ name: e.target.value })} />
              </Field>
              <Field label="Python do XTTS (python.exe do ambiente com o pacote TTS)">
                <input value={draft.tts.custom.xttsPython} onChange={(e) => setCustom({ xttsPython: e.target.value })} />
              </Field>
              <Field label="Pasta do modelo XTTS v2" hint="Pasta com config.json, model.pth, vocab.json e speakers_xtts.pth.">
                <input value={draft.tts.custom.xttsModelDir} onChange={(e) => setCustom({ xttsModelDir: e.target.value })} />
              </Field>
              <Field label="Latentes da voz (.pt)">
                <input value={draft.tts.custom.xttsLatents} onChange={(e) => setCustom({ xttsLatents: e.target.value })} />
              </Field>
              <Field label="Onde o XTTS roda">
                <select value={draft.tts.custom.xttsDevice} onChange={(e) => setCustom({ xttsDevice: e.target.value as Settings['tts']['custom']['xttsDevice'] })}>
                  <option value="cuda">Placa de vídeo (mais rápido)</option>
                  <option value="on-demand">Placa de vídeo só enquanto fala (economiza memória de vídeo)</option>
                  <option value="cpu">Processador (lento)</option>
                </select>
              </Field>
              <label className="check">
                <input type="checkbox" checked={draft.tts.custom.rvcEnabled} onChange={(e) => setCustom({ rvcEnabled: e.target.checked })} />
                Aplicar o timbre do modelo RVC
              </label>
              {draft.tts.custom.rvcEnabled && (
                <>
                  <Field label="Python do RVC">
                    <input value={draft.tts.custom.rvcPython} onChange={(e) => setCustom({ rvcPython: e.target.value })} />
                  </Field>
                  <Field label="Pasta do RVC" hint="Pasta do Retrieval-based-Voice-Conversion (com infer\ e assets\).">
                    <input value={draft.tts.custom.rvcDir} onChange={(e) => setCustom({ rvcDir: e.target.value })} />
                  </Field>
                  <Field label="Modelo RVC (.pth)">
                    <input value={draft.tts.custom.rvcModel} onChange={(e) => setCustom({ rvcModel: e.target.value })} />
                  </Field>
                  <Field label="Índice RVC (.index, opcional)">
                    <input value={draft.tts.custom.rvcIndex} onChange={(e) => setCustom({ rvcIndex: e.target.value })} />
                  </Field>
                  <Field label="Onde o RVC roda">
                    <select value={draft.tts.custom.rvcDevice} onChange={(e) => setCustom({ rvcDevice: e.target.value as Settings['tts']['custom']['rvcDevice'] })}>
                      <option value="cuda">Placa de vídeo (bem mais rápido)</option>
                      <option value="cpu">Processador (libera memória de vídeo)</option>
                    </select>
                  </Field>
                  <Field label={`Tom: ${draft.tts.custom.rvcPitch > 0 ? '+' : ''}${draft.tts.custom.rvcPitch} semitons`}>
                    <input type="range" min={-6} max={8} step={1} value={draft.tts.custom.rvcPitch} onChange={(e) => setCustom({ rvcPitch: Number(e.target.value) })} />
                  </Field>
                  <Field label="Detecção de tom">
                    <select value={draft.tts.custom.rvcF0Method} onChange={(e) => setCustom({ rvcF0Method: e.target.value as Settings['tts']['custom']['rvcF0Method'] })}>
                      <option value="rmvpe">RMVPE (mais fiel à voz)</option>
                      <option value="pm">PM (mais rápido)</option>
                    </select>
                  </Field>
                  <Field label={`Força do timbre (índice): ${draft.tts.custom.rvcIndexRate.toFixed(2)}`}>
                    <input type="range" min={0} max={1} step={0.05} value={draft.tts.custom.rvcIndexRate} onChange={(e) => setCustom({ rvcIndexRate: Number(e.target.value) })} />
                  </Field>
                  <Field label={`Proteção de consoantes e respiração: ${draft.tts.custom.rvcProtect.toFixed(2)}`}>
                    <input type="range" min={0} max={0.5} step={0.01} value={draft.tts.custom.rvcProtect} onChange={(e) => setCustom({ rvcProtect: Number(e.target.value) })} />
                  </Field>
                  <Button variant="ghost" onClick={() => setCustom({ rvcPitch: 3, rvcF0Method: 'rmvpe', rvcIndexRate: 0.5, rvcProtect: 0.33 })}>
                    Voltar ao ajuste escolhido (D3)
                  </Button>
                </>
              )}
            </>
          )}
          {draft.tts.provider === 'elevenlabs' && (
            <>
              <SecretField label="Chave de API da ElevenLabs" secretKey="elevenApiKey" info={secrets} onChanged={loadSecrets} />
              <Field label="Voice ID" hint="Em elevenlabs.io → Voices, no menu ⋯ da voz → Copy voice ID.">
                <input value={draft.tts.elevenVoiceId} placeholder="ex.: 21m00Tcm4TlvDq8ikWAM" onChange={(e) => set('tts', { elevenVoiceId: e.target.value.trim() })} />
              </Field>
              <Field label="Modelo de voz">
                <select value={draft.tts.elevenModel} onChange={(e) => set('tts', { elevenModel: e.target.value })}>
                  <option value="eleven_v4">v4 (igual ao site, com emoção, recomendado)</option>
                  <option value="eleven_v4_turbo">v4 Turbo (responde mais rápido, gasta menos)</option>
                  <option value="eleven_v3">v3 (expressiva)</option>
                  <option value="eleven_multilingual_v2">Multilingual v2 (sem emoção, bem estável)</option>
                  <option value="eleven_flash_v2_5">Flash v2.5 (muito rápido, mas muda bastante a voz)</option>
                </select>
              </Field>
              {/^eleven_v[34]/.test(draft.tts.elevenModel) && (
                <Field label="Jeito de falar">
                  <select value={draft.tts.elevenTone} onChange={(e) => set('tts', { elevenTone: e.target.value as Settings['tts']['elevenTone'] })}>
                    <option value="none">Natural, com emoções só quando precisar (recomendado)</option>
                    <option value="warm">Sempre acolhedora (calma e suave)</option>
                    <option value="cute">Sempre fofa (doce e animada)</option>
                  </select>
                </Field>
              )}
              <Field label={`Estabilidade: ${draft.tts.elevenStability.toFixed(2)}`} hint="Mais baixo deixa a fala mais emotiva; mais alto, mais constante.">
                <input type="range" min={0} max={1} step={0.05} value={draft.tts.elevenStability} onChange={(e) => set('tts', { elevenStability: Number(e.target.value) })} />
              </Field>
              <Field label={`Semelhança com a voz original: ${draft.tts.elevenSimilarity.toFixed(2)}`}>
                <input type="range" min={0} max={1} step={0.05} value={draft.tts.elevenSimilarity} onChange={(e) => set('tts', { elevenSimilarity: Number(e.target.value) })} />
              </Field>
              <Button variant="ghost" onClick={() => set('tts', { elevenModel: 'eleven_v4', elevenStability: 0.5, elevenSimilarity: 0.75, elevenTone: 'none', rate: 1 })}>
                Voltar aos ajustes do site
              </Button>
              <p className="field-hint">O texto de cada frase da Yui é enviado para a ElevenLabs para virar áudio. Nada pesado roda no seu PC.</p>
            </>
          )}
          {draft.tts.provider === 'fish-audio' && (
            <>
              <SecretField label="Chave de API da Fish Audio" secretKey="ttsApiKey" info={secrets} onChanged={loadSecrets} />
              <Field label="Código da voz" hint="Na página da voz em fish.audio, é o código no fim do endereço (32 letras e números).">
                <input value={draft.tts.fishVoiceId} placeholder="ex.: 8ef4a238714b45718ce04243307c57a7" onChange={(e) => set('tts', { fishVoiceId: e.target.value.trim() })} />
              </Field>
              <Field label="Modelo de síntese" hint="Use o gratuito enquanto testa; os outros gastam créditos.">
                <select value={draft.tts.fishModel} onChange={(e) => set('tts', { fishModel: e.target.value })}>
                  <option value="s2.1-pro">S2.1 Pro (melhor qualidade)</option>
                  <option value="s2.1-pro-free">S2.1 Pro grátis (plano gratuito de desenvolvedor)</option>
                  <option value="s2-pro">S2 Pro</option>
                  <option value="s1">S1 (mais antigo)</option>
                </select>
              </Field>
              <Field label="Rapidez da resposta">
                <select value={draft.tts.fishLatency} onChange={(e) => set('tts', { fishLatency: e.target.value as Settings['tts']['fishLatency'] })}>
                  <option value="balanced">Equilibrada (recomendada)</option>
                  <option value="low">Mais rápida</option>
                  <option value="normal">Mais qualidade</option>
                </select>
              </Field>
              <p className="field-hint">O texto de cada frase da Yui é enviado para a Fish Audio para virar áudio. Nada pesado roda no seu PC.</p>
            </>
          )}
          {draft.tts.provider !== 'system' && draft.tts.provider !== 'none' && (
            <div className="inline-row">
              <Button icon="volume" onClick={testVoice} disabled={dirty || testing}>
                {testing ? 'Gerando a fala…' : 'Ouvir a voz'}
              </Button>
              <span className="field-hint">
                {dirty ? 'Salve antes de testar.' : testMsg ?? 'A primeira fala demora enquanto os modelos carregam.'}
              </span>
            </div>
          )}
          {draft.tts.provider === 'piper' && (
            <>
              <Field label="Caminho do piper.exe">
                <input value={draft.tts.piperPath} placeholder="C:\\piper\\piper.exe" onChange={(e) => set('tts', { piperPath: e.target.value })} />
              </Field>
              <Field label="Modelo de voz (.onnx)" hint="Ex.: pt_BR-faber-medium.onnx (deixe o .onnx.json na mesma pasta).">
                <input value={draft.tts.piperModel} placeholder="C:\\piper\\pt_BR-faber-medium.onnx" onChange={(e) => set('tts', { piperModel: e.target.value })} />
              </Field>
            </>
          )}
          {draft.tts.provider === 'openai-compatible' && (
            <>
              <Field label="Endereço do servidor">
                <input value={draft.tts.baseUrl} onChange={(e) => set('tts', { baseUrl: e.target.value })} />
              </Field>
              <Field label="Modelo"><input value={draft.tts.model} onChange={(e) => set('tts', { model: e.target.value })} /></Field>
              <Field label="Voz" hint="Ex.: pf_dora (Kokoro, português)."><input value={draft.tts.voice} onChange={(e) => set('tts', { voice: e.target.value })} /></Field>
              <SecretField label="Chave de API (opcional)" secretKey="ttsApiKey" info={secrets} onChanged={loadSecrets} />
            </>
          )}
          {draft.tts.provider !== 'none' && (
            <Field label={`Velocidade da fala: ${draft.tts.rate.toFixed(1)}×`}>
              <input type="range" min={0.6} max={1.6} step={0.1} value={draft.tts.rate} onChange={(e) => set('tts', { rate: Number(e.target.value) })} />
            </Field>
          )}
        </div>
      )}

      {tab === 'microfone' && (
        <div className="settings-grid">
          <StatusLine title="Reconhecimento de fala" status={status?.stt} checking={checking} />

          <h3 className="settings-sub">Modo do microfone</h3>
          <div className="choice-list" role="radiogroup" aria-label="Modo do microfone">
            {MIC_MODES.map((m) => (
              <label key={m.id} className={`choice ${draft.voice.micMode === m.id ? 'is-selected' : ''}`}>
                <input type="radio" name="mic-mode" checked={draft.voice.micMode === m.id} onChange={() => set('voice', { micMode: m.id })} />
                <span>
                  <strong>{m.label}</strong>
                  <small>{m.text}</small>
                </span>
              </label>
            ))}
          </div>

          {draft.voice.micMode === 'push' && (
            <Field label="Tecla para falar" hint="Segure a tecla enquanto fala e solte para enviar. Funciona com a janela da Yui em primeiro plano; clicar no botão do microfone também grava e envia.">
              <select value={draft.voice.pushKey} onChange={(e) => set('voice', { pushKey: e.target.value })}>
                {Object.entries(PUSH_KEYS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </Field>
          )}

          {draft.voice.micMode === 'tap' && (
            <>
              <label className="check">
                <input type="checkbox" checked={draft.voice.autoStopOnSilence} onChange={(e) => set('voice', { autoStopOnSilence: e.target.checked })} />
                Enviar automaticamente quando eu parar de falar
              </label>
              <label className="check">
                <input type="checkbox" checked={draft.voice.continuousConversation} onChange={(e) => set('voice', { continuousConversation: e.target.checked })} />
                Voltar a ouvir automaticamente depois de responder
              </label>
            </>
          )}

          <h3 className="settings-sub">Ajustes</h3>
          <Field
            label={`Sensibilidade: ${draft.voice.micSensitivity}`}
            hint="Aumente se a Yui não percebe quando você fala baixo; diminua se ela capta barulho do ambiente."
          >
            <input type="range" min={1} max={10} step={1} value={draft.voice.micSensitivity}
              onChange={(e) => set('voice', { micSensitivity: Number(e.target.value) })} />
          </Field>
          {draft.voice.micMode !== 'push' && (
            <Field
              label={`Pausa para enviar: ${draft.voice.silenceSeconds.toFixed(1).replace('.', ',')} s`}
              hint="Quanto tempo de silêncio a Yui espera até entender que você terminou de falar."
            >
              <input type="range" min={0.6} max={3} step={0.1} value={draft.voice.silenceSeconds}
                onChange={(e) => set('voice', { silenceSeconds: Number(e.target.value) })} />
            </Field>
          )}
          <p className="field-hint">
            O microfone só liga depois que você inicia a conversa por voz, e o áudio não fica salvo no PC.
            No microfone livre, use o botão de silenciar do painel de voz quando não quiser ser ouvido.
          </p>
        </div>
      )}

      {tab === 'aparencia' && (
        <AppearanceTab
          avatar={draft.avatar}
          onChange={async (avatar) => {
            // Salva na hora só a aparência, sem levar junto outras mudanças ainda não salvas.
            setDraft((d) => ({ ...d, avatar }))
            await onSave({ ...settings, avatar })
          }}
        />
      )}

      {tab === 'memoria' && <MemoryTab />}

      {tab === 'privacidade' && (
        <div className="settings-grid prose">
          <p><strong>Você escolhe onde cada parte roda.</strong> Com provedores locais, nada sai do seu PC. Com serviços na nuvem (Fish Audio, Groq e parecidos), o texto ou o áudio de cada pedido é enviado para eles. Só o texto das conversas é salvo no histórico; o áudio do microfone nunca é gravado.</p>
          <p><strong>Ações permitidas</strong> (lista fixa — a Yui não executa comandos de terminal):</p>
          <ul>
            <li>Sem confirmação: encontrar arquivos, abrir pastas, abrir documentos (não executáveis) e abrir aplicativos do Menu Iniciar.</li>
            <li>Com confirmação: pesquisar na internet, abrir sites, criar pastas, mover, renomear e enviar arquivos para a Lixeira.</li>
            <li>Bloqueado: instalar programas, terminais, editor do registro, arquivos fora da sua pasta de usuário e pastas do sistema.</li>
          </ul>
          <p>Ações pedidas por voz seguem exatamente as mesmas regras e confirmações das pedidas por texto.</p>
          {secrets && !secrets.encryptionAvailable && (
            <p className="muted">A criptografia do Windows não está disponível nesta sessão; chaves de API não poderão ser salvas.</p>
          )}
        </div>
      )}
    </Modal>
  )
}
