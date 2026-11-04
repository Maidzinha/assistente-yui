import { useCallback, useEffect, useState } from 'react'
import type { ConversationSummary, ProvidersStatus, Settings } from '@shared/types'
import { api, errorMessage } from '../lib/api'

export function useSettingsAndStatus() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<ProvidersStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    if (!api) return
    setChecking(true)
    try {
      setStatus(await api.settings.providersStatus())
    } catch (err) {
      setLoadError(errorMessage(err))
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (!api) {
      setLoadError('A ponte com o sistema não está disponível. Inicie o aplicativo com “npm run dev”.')
      return
    }
    api.settings.get().then(setSettings, (err) => setLoadError(errorMessage(err)))
    void refreshStatus()
  }, [refreshStatus])

  const save = useCallback(async (next: Settings) => {
    if (!api) return
    setSettings(await api.settings.save(next))
    await refreshStatus()
  }, [refreshStatus])

  return { settings, status, checking, loadError, refreshStatus, save }
}

export function useRecent() {
  const [items, setItems] = useState<ConversationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!api) {
      setItems([])
      return
    }
    try {
      setItems(await api.history.list())
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const remove = useCallback(async (id: string) => {
    await api?.history.remove(id)
    await reload()
  }, [reload])

  return { items, error, reload, remove }
}
