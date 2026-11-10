import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConfirmRequest } from '@shared/types'
import { Composer, type ComposerHandle } from './components/Composer'
import { ConfirmDialog, MicConsentDialog } from './components/Dialogs'
import { Icon } from './components/Icon'
import { RecentActivity } from './components/RecentActivity'
import { SettingsDialog, StatusLine } from './components/SettingsDialog'
import { Shortcuts } from './components/Shortcuts'
import { CharacterPanel, VoicePanel, type Presence } from './components/SidePanels'
import { Thread } from './components/Thread'
import { UsagePanel } from './components/UsagePanel'
import { Button, IconButton, Notice, SectionLabel } from './components/ui'
import { useChat } from './hooks/useChat'
import { useRecent, useSettingsAndStatus } from './hooks/useProviders'
import { pushKeyLabel, useVoice } from './hooks/useVoice'
import { api } from './lib/api'

function greeting(): string {
  const h = new Date().getHours()
  return h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

export function App() {
  const { settings, status, checking, loadError, refreshStatus, save } = useSettingsAndStatus()
  const recent = useRecent()
  const chat = useChat(recent.reload)
  const voice = useVoice({ settings, status, send: chat.send, cancelTurn: chat.cancel, subscribe: chat.subscribe })
  const [settingsTab, setSettingsTab] = useState<'ia' | 'voz' | 'microfone' | null>(null)
  const [confirms, setConfirms] = useState<ConfirmRequest[]>([])
  const composer = useRef<ComposerHandle>(null)
  // Coluna da Yui recolhida (modo foco na conversa); a escolha fica guardada.
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try { return localStorage.getItem('yui.coluna') === 'oculta' } catch { return false }
  })
  const toggleSidebar = useCallback(() => {
    setSidebarHidden((hidden) => {
      try { localStorage.setItem('yui.coluna', hidden ? 'visivel' : 'oculta') } catch { /* sem armazenamento */ }
      return !hidden
    })
  }, [])

  useEffect(() => api?.actions.onConfirmRequest((req) => setConfirms((c) => [...c, req])), [])

  // Fecha pedidos de confirmação de ações que já terminaram (por exemplo, cancelamento).
  useEffect(() => {
    if (!chat.streaming) setConfirms([])
  }, [chat.streaming])

  const answerConfirm = useCallback((req: ConfirmRequest, approved: boolean) => {
    api?.actions.respond(req.actionId, approved)
    setConfirms((c) => c.filter((r) => r.actionId !== req.actionId))
  }, [])

  const { send, newConversation } = chat
  const { speakTurn, stopSpeaking } = voice
  const speakTextReplies = settings?.voice.speakTextReplies

  const sendText = useCallback(async (text: string) => {
    const turnId = await send(text, 'text')
    if (turnId && speakTextReplies) speakTurn(turnId)
  }, [send, speakTextReplies, speakTurn])

  const startNewConversation = useCallback(() => {
    stopSpeaking()
    newConversation()
  }, [stopSpeaking, newConversation])

  // Atalhos de teclado: Ctrl+N nova conversa, Ctrl+, configurações, Ctrl+B mostra/esconde a Yui.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey) return
      const k = e.key.toLowerCase()
      if (k === 'n') startNewConversation()
      else if (k === ',') setSettingsTab((t) => t ?? 'ia')
      else if (k === 'b') toggleSidebar()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startNewConversation, toggleSidebar])

  const llmOk = status?.llm.ok === true
  const inThread = chat.messages.length > 0 || chat.loadingConversation
  const busy = Boolean(chat.streaming)

  const presence: Presence = !status
    ? 'loading'
    : confirms.length ? 'confirming'
    : voice.state === 'listening' ? 'listening'
    : voice.state === 'speaking' ? 'speaking'
    : busy || voice.state === 'transcribing' || voice.state === 'thinking' ? 'thinking'
    : llmOk ? 'ready' : 'offline'

  const setupNotice = status && !llmOk && (
    <Notice
      tone="warning"
      title="A IA ainda não está conectada"
      actions={
        <>
          <Button variant="primary" icon="settings" onClick={() => setSettingsTab('ia')}>Abrir configurações</Button>
          <Button variant="ghost" icon="refresh" onClick={refreshStatus} disabled={checking}>{checking ? 'Verificando…' : 'Verificar de novo'}</Button>
        </>
      }
    >
      <StatusLine title="Detalhe" status={status.llm} checking={checking} />
    </Notice>
  )

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <Icon name="logo" size={26} className="brand-icon" />
          <span>Assistente <em>Yui</em></span>
        </div>
      </header>

      <div className={`layout ${sidebarHidden ? 'is-focus' : ''}`}>
        <nav className="rail" aria-label="Navegação">
          <IconButton icon="home" label="Início" active={!inThread} onClick={startNewConversation} />
          <IconButton
            icon="chat"
            label="Continuar a última conversa"
            active={inThread}
            disabled={!inThread && !recent.items?.length}
            onClick={() => !inThread && recent.items?.[0] && void chat.openConversation(recent.items[0].id)}
          />
          <IconButton icon="plus" label="Nova conversa (Ctrl+N)" onClick={startNewConversation} />
          <span className="rail-space" />
          <IconButton
            icon="sidebar"
            label={sidebarHidden ? 'Mostrar a Yui (Ctrl+B)' : 'Esconder a Yui (Ctrl+B)'}
            className={sidebarHidden ? '' : 'is-on'}
            onClick={toggleSidebar}
          />
          <IconButton icon="settings" label="Configurações (Ctrl+,)" onClick={() => setSettingsTab('ia')} />
        </nav>
        <main className={`workspace ${inThread ? 'is-thread' : 'is-home'}`}>
          {loadError && <Notice tone="error" title="Erro ao iniciar">{loadError}</Notice>}

          {!inThread ? (
            <div className="home">
              <p className="greeting">{greeting()} <span aria-hidden="true">♡</span></p>
              <h1 className="headline">O que vamos <em>resolver</em> hoje?</h1>
              {setupNotice}
              <Composer
                ref={composer}
                busy={busy}
                voiceActive={voice.active}
                voiceState={voice.state}
                level={voice.level}
                onSend={(t) => void sendText(t)}
                onCancel={chat.cancel}
                onMic={voice.primary}
              />
              {chat.sendError && <Notice tone="error" title="Não foi possível enviar">{chat.sendError}</Notice>}
              <Shortcuts onPick={(s) => composer.current?.prefill(s.prefill)} />
              <SectionLabel>Conversas recentes</SectionLabel>
              <RecentActivity
                items={recent.items}
                error={recent.error}
                activeId={chat.conversationId}
                onOpen={(id) => void chat.openConversation(id)}
                onRemove={(id) => void recent.remove(id)}
                onRetry={recent.reload}
              />
            </div>
          ) : (
            <div className="conversation">
              <div className="conversation-head">
                <button type="button" className="link-btn back" onClick={startNewConversation}>
                  <Icon name="home" size={16} /> Início
                </button>
                <span className="muted small">Texto e voz compartilham esta conversa</span>
              </div>
              {setupNotice}
              <Thread messages={chat.messages} streaming={chat.streaming} spoken={voice.spoken} loading={chat.loadingConversation} />
              {chat.sendError && <Notice tone="error" title="Não foi possível enviar">{chat.sendError}</Notice>}
              <Composer
                ref={composer}
                compact
                busy={busy}
                voiceActive={voice.active}
                voiceState={voice.state}
                level={voice.level}
                onSend={(t) => void sendText(t)}
                onCancel={chat.cancel}
                onMic={voice.primary}
              />
              <Shortcuts compact onPick={(s) => composer.current?.prefill(s.prefill)} />
            </div>
          )}
        </main>

        <aside className={`sidebar presence-${presence}`} hidden={sidebarHidden}>
          <CharacterPanel presence={presence} sentence={voice.spoken?.sentence} avatar={settings?.avatar} />
          <VoicePanel
            mode={voice.mode}
            pushKey={pushKeyLabel(settings?.voice.pushKey)}
            onOpenMicSettings={() => setSettingsTab('microfone')}
            state={voice.state}
            active={voice.active}
            level={voice.level}
            micMuted={voice.micMuted}
            voiceMuted={voice.voiceMuted}
            sttReady={voice.sttReady}
            statusLoading={!status}
            confirming={confirms.length > 0}
            error={voice.error}
            notice={voice.notice}
            lastTranscript={voice.lastTranscript}
            onPrimary={voice.primary}
            onInterrupt={voice.interrupt}
            onEnd={voice.endSession}
            onToggleMic={voice.toggleMic}
            onToggleVoice={voice.toggleVoice}
            onOpenSettings={() => setSettingsTab('voz')}
            onDismissError={voice.dismissError}
            onStopSpeaking={voice.stopSpeaking}
          />
          <UsagePanel refreshKey={`${chat.messages.length}-${voice.state === 'idle'}-${settings?.tts.provider}-${settings?.llm.baseUrl}`} />
        </aside>
      </div>

      {confirms[0] && <ConfirmDialog req={confirms[0]} onAnswer={(ok) => answerConfirm(confirms[0], ok)} />}
      {voice.consentNeeded && <MicConsentDialog onAccept={voice.acceptConsent} onDecline={voice.declineConsent} />}
      {settingsTab && settings && (
        <SettingsDialog
          settings={settings}
          status={status}
          checking={checking}
          initialTab={settingsTab}
          onSave={save}
          onRecheck={refreshStatus}
          onClose={() => setSettingsTab(null)}
        />
      )}
    </div>
  )
}
