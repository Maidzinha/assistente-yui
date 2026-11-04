import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionRecord, ChatEvent, ChatMessage, MessageSource } from '@shared/types'
import { api, errorMessage } from '../lib/api'

export interface StreamingTurn {
  turnId: string
  source: MessageSource
  text: string
  actions: ActionRecord[]
}

type Listener = (event: ChatEvent) => void

/** Estado da conversa atual. Texto e voz usam este mesmo hook e o mesmo histórico. */
export function useChat(onHistoryChanged: () => void) {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState<StreamingTurn | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [loadingConversation, setLoadingConversation] = useState(false)
  const listeners = useRef(new Set<Listener>())
  const activeTurn = useRef<string | null>(null)
  const historyChanged = useRef(onHistoryChanged)
  historyChanged.current = onHistoryChanged

  useEffect(() => {
    if (!api) return
    return api.chat.onEvent((event) => {
      listeners.current.forEach((l) => l(event))
      if (event.turnId !== activeTurn.current) return
      if (event.type === 'delta') {
        setStreaming((s) => (s ? { ...s, text: s.text + event.text } : s))
      } else if (event.type === 'action') {
        setStreaming((s) => {
          if (!s) return s
          const others = s.actions.filter((a) => a.id !== event.action.id)
          return { ...s, actions: [...others, event.action] }
        })
      } else {
        activeTurn.current = null
        setStreaming(null)
        setMessages((m) => [...m, event.message])
        historyChanged.current()
      }
    })
  }, [])

  const subscribe = useCallback((l: Listener) => {
    listeners.current.add(l)
    return () => listeners.current.delete(l)
  }, [])

  const send = useCallback(
    async (text: string, source: MessageSource): Promise<string | null> => {
      if (!api) {
        setSendError('A ponte com o sistema não está disponível. Abra o aplicativo pelo Electron.')
        return null
      }
      if (activeTurn.current) return null
      setSendError(null)
      try {
        const res = await api.chat.send(conversationId, text, source)
        activeTurn.current = res.turnId
        setConversationId(res.conversationId)
        setMessages((m) => [...m, res.userMessage])
        setStreaming({ turnId: res.turnId, source, text: '', actions: [] })
        historyChanged.current()
        return res.turnId
      } catch (err) {
        setSendError(errorMessage(err))
        return null
      }
    },
    [conversationId]
  )

  const cancel = useCallback(() => {
    if (activeTurn.current) api?.chat.cancel(activeTurn.current)
  }, [])

  const newConversation = useCallback(() => {
    cancel()
    activeTurn.current = null
    setStreaming(null)
    setConversationId(null)
    setMessages([])
    setSendError(null)
  }, [cancel])

  const openConversation = useCallback(async (id: string) => {
    if (!api) return
    cancel()
    activeTurn.current = null
    setStreaming(null)
    setLoadingConversation(true)
    try {
      const conv = await api.history.get(id)
      if (!conv) throw new Error('Essa conversa não existe mais.')
      setConversationId(conv.id)
      setMessages(conv.messages)
      setSendError(null)
    } catch (err) {
      setSendError(errorMessage(err))
    } finally {
      setLoadingConversation(false)
    }
  }, [cancel])

  return {
    conversationId, messages, streaming, sendError, loadingConversation,
    send, cancel, subscribe, newConversation, openConversation, clearError: () => setSendError(null)
  }
}
