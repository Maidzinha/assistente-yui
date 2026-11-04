import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { loadAvatar, pickAvatar, removeAvatar } from './avatar'
import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/ipc'
import type {
  ChatEvent, ChatMessage, ConfirmRequest, Conversation, MessageSource, SecretKey, Settings, StartTurnResult
} from '@shared/types'
import { runTurn } from './ai/agent'
import { getLlm } from './ai/index'
import { cancelAction } from './actions/runner'
import { getSecretsInfo, getSettings, saveSettings, setSecret } from './config/store'
import { getConversation, listConversations, removeConversation, saveConversation } from './conversation/history'
import { clearMemories, listMemories, removeMemory } from './memory/store'
import { getUsage } from './usage'
import { getStt, prewarmStt, sttHealth } from './voice/stt'
import { getTts, prewarmTts, ttsHealth } from './voice/tts'

const turns = new Map<string, AbortController>()
const pendingConfirms = new Map<string, { turnId: string; resolve: (ok: boolean) => void }>()

const SECRET_KEYS: SecretKey[] = ['llmApiKey', 'sttApiKey', 'ttsApiKey', 'elevenApiKey']
const MAX_AUDIO_BYTES = 16_000 * 2 * 90 // ~90 s de WAV 16 kHz mono

function send(wc: WebContents, event: ChatEvent) {
  if (!wc.isDestroyed()) wc.send(IPC.chatEvent, event)
}

function makeTitle(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean || 'Nova conversa'
}

async function startTurn(wc: WebContents, conversationId: string | null, text: string, source: MessageSource): Promise<StartTurnResult> {
  const settings = await getSettings()
  const now = Date.now()
  let conv: Conversation | null = conversationId ? await getConversation(conversationId) : null
  if (!conv) conv = { id: randomUUID(), title: makeTitle(text), createdAt: now, updatedAt: now, messages: [] }

  const userMessage: ChatMessage = { id: randomUUID(), role: 'user', content: text, source, createdAt: now }
  conv.messages.push(userMessage)
  conv.updatedAt = now
  await saveConversation(conv)

  const turnId = randomUUID()
  const controller = new AbortController()
  turns.set(turnId, controller)
  const conversation = conv
  let partial = ''

  void (async () => {
    const assistant: ChatMessage = { id: randomUUID(), role: 'assistant', content: '', source, createdAt: Date.now(), actions: [] }
    try {
      const out = await runTurn({
        turnId,
        settings,
        history: conversation.messages,
        source,
        signal: controller.signal,
        onDelta: (t) => {
          partial += t
          send(wc, { type: 'delta', turnId, text: t })
        },
        onAction: (action) => send(wc, { type: 'action', turnId, action }),
        requestConfirmation: (req: ConfirmRequest) =>
          new Promise<boolean>((resolve) => {
            if (controller.signal.aborted) return resolve(false)
            pendingConfirms.set(req.actionId, { turnId, resolve })
            if (!wc.isDestroyed()) wc.send(IPC.actionConfirmRequest, req)
          })
      })
      assistant.content = out.content
      assistant.actions = out.actions
      if (controller.signal.aborted) assistant.content = (partial.trim() || '') + (partial.trim() ? ' ' : '') + '(resposta interrompida)'
      conversation.messages.push(assistant)
      conversation.updatedAt = Date.now()
      await saveConversation(conversation)
      send(wc, { type: 'done', turnId, conversationId: conversation.id, message: assistant })
    } catch (err) {
      const aborted = controller.signal.aborted
      assistant.content = partial.trim()
      if (aborted) assistant.content += (assistant.content ? ' ' : '') + '(resposta interrompida)'
      else assistant.error = (err as Error).message || 'Erro desconhecido ao falar com a IA.'
      conversation.messages.push(assistant)
      conversation.updatedAt = Date.now()
      await saveConversation(conversation)
      send(wc, { type: aborted ? 'done' : 'error', turnId, conversationId: conversation.id, message: assistant })
    } finally {
      turns.delete(turnId)
      for (const [id, p] of pendingConfirms) if (p.turnId === turnId) { p.resolve(false); pendingConfirms.delete(id) }
    }
  })()

  return { turnId, conversationId: conversation.id, userMessage }
}

const asString = (v: unknown, max = 20_000) => {
  if (typeof v !== 'string') throw new Error('Valor inválido.')
  return v.slice(0, max)
}

export function registerIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSave, async (_e, s: Settings) => {
    const saved = await saveSettings(s)
    void prewarmTts(saved)
    void prewarmStt(saved)
    return saved
  })
  ipcMain.handle(IPC.secretsInfo, () => getSecretsInfo())
  ipcMain.handle(IPC.secretsSet, (_e, key: SecretKey, value: string | null) => {
    if (!SECRET_KEYS.includes(key)) throw new Error('Chave desconhecida.')
    return setSecret(key, value ? asString(value, 4000) : null)
  })
  ipcMain.handle(IPC.providersStatus, async () => {
    const settings = await getSettings()
    // Reinicia serviços de voz que falharam (botão “Verificar conexões”).
    await Promise.all([prewarmTts(settings), prewarmStt(settings)])
    const [llm, stt, tts] = await Promise.all([
      getLlm(settings).then((a) => a.health()),
      sttHealth(settings),
      ttsHealth(settings)
    ])
    return { llm, stt, tts }
  })

  ipcMain.handle(IPC.chatSend, (e, conversationId: string | null, text: unknown, source: MessageSource) => {
    const t = asString(text).trim()
    if (!t) throw new Error('Mensagem vazia.')
    return startTurn(e.sender, conversationId, t, source === 'voice' ? 'voice' : 'text')
  })
  ipcMain.on(IPC.chatCancel, (_e, turnId: string) => turns.get(turnId)?.abort())

  ipcMain.handle(IPC.historyList, () => listConversations())
  ipcMain.handle(IPC.historyGet, (_e, id: string) => getConversation(asString(id, 100)))
  ipcMain.handle(IPC.historyRemove, (_e, id: string) => removeConversation(asString(id, 100)))

  ipcMain.handle(IPC.usageGet, async () => getUsage(await getSettings()))

  ipcMain.handle(IPC.avatarPick, (e) => pickAvatar(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle(IPC.avatarLoad, () => loadAvatar())
  ipcMain.handle(IPC.avatarRemove, () => removeAvatar())

  ipcMain.handle(IPC.memoryList, () => listMemories())
  ipcMain.handle(IPC.memoryRemove, (_e, id: string) => removeMemory(asString(id, 100)))
  ipcMain.handle(IPC.memoryClear, () => clearMemories())

  ipcMain.on(IPC.actionConfirmResponse, (_e, actionId: string, approved: boolean) => {
    const p = pendingConfirms.get(actionId)
    if (!p) return
    pendingConfirms.delete(actionId)
    p.resolve(approved === true)
  })
  ipcMain.on(IPC.actionCancel, (_e, actionId: string) => {
    const p = pendingConfirms.get(actionId)
    if (p) { pendingConfirms.delete(actionId); p.resolve(false) }
    cancelAction(actionId)
  })

  ipcMain.handle(IPC.voiceTranscribe, async (_e, wav: ArrayBuffer, language: string) => {
    if (!(wav instanceof ArrayBuffer) || wav.byteLength < 44 || wav.byteLength > MAX_AUDIO_BYTES) {
      throw new Error('Áudio inválido ou longo demais.')
    }
    const settings = await getSettings()
    const stt = await getStt(settings)
    if (!stt) throw new Error('Nenhum provedor de transcrição configurado. Abra Configurações → Voz.')
    // O áudio fica só na memória durante a transcrição.
    return stt.transcribe(wav, asString(language, 10))
  })
  ipcMain.handle(IPC.voiceSynthesize, async (_e, text: unknown) => {
    const settings = await getSettings()
    const tts = await getTts(settings)
    if (!tts) throw new Error('A síntese de voz deste provedor é feita pela interface.')
    return tts.synthesize(asString(text, 2000))
  })
}
