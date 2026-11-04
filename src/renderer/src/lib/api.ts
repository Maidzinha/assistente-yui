import type { AssistantApi } from '../../../preload/api'

/** Ponte com o processo principal. Ausente se a interface for aberta fora do Electron. */
export const api: AssistantApi | null = typeof window !== 'undefined' ? (window.assistant ?? null) : null

export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // Remove o prefixo que o Electron adiciona a erros vindos do IPC.
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
