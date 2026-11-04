import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { AssistantApi } from './api'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Superfície mínima exposta à interface. Nada de Node ou ipcRenderer direto.
const api: AssistantApi = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    save: (s) => ipcRenderer.invoke(IPC.settingsSave, s),
    secretsInfo: () => ipcRenderer.invoke(IPC.secretsInfo),
    setSecret: (key, value) => ipcRenderer.invoke(IPC.secretsSet, key, value),
    providersStatus: () => ipcRenderer.invoke(IPC.providersStatus)
  },
  chat: {
    send: (conversationId, text, source) => ipcRenderer.invoke(IPC.chatSend, conversationId, text, source),
    cancel: (turnId) => ipcRenderer.send(IPC.chatCancel, turnId),
    onEvent: (cb) => subscribe(IPC.chatEvent, cb)
  },
  history: {
    list: () => ipcRenderer.invoke(IPC.historyList),
    get: (id) => ipcRenderer.invoke(IPC.historyGet, id),
    remove: (id) => ipcRenderer.invoke(IPC.historyRemove, id)
  },
  actions: {
    onConfirmRequest: (cb) => subscribe(IPC.actionConfirmRequest, cb),
    respond: (actionId, approved) => ipcRenderer.send(IPC.actionConfirmResponse, actionId, approved),
    cancel: (actionId) => ipcRenderer.send(IPC.actionCancel, actionId)
  },
  usage: {
    get: () => ipcRenderer.invoke(IPC.usageGet)
  },
  avatar: {
    pick: () => ipcRenderer.invoke(IPC.avatarPick),
    load: () => ipcRenderer.invoke(IPC.avatarLoad),
    remove: () => ipcRenderer.invoke(IPC.avatarRemove)
  },
  memory: {
    list: () => ipcRenderer.invoke(IPC.memoryList),
    remove: (id) => ipcRenderer.invoke(IPC.memoryRemove, id),
    clear: () => ipcRenderer.invoke(IPC.memoryClear)
  },
  voice: {
    transcribe: (wav, language) => ipcRenderer.invoke(IPC.voiceTranscribe, wav, language),
    synthesize: (text) => ipcRenderer.invoke(IPC.voiceSynthesize, text)
  }
}

contextBridge.exposeInMainWorld('assistant', api)
