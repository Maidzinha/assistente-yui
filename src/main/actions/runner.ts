import { randomUUID } from 'node:crypto'
import type { ActionRecord, ConfirmRequest, MessageSource } from '@shared/types'
import { ACTIONS } from './definitions'
import type { ToolCall, ToolSpec } from '../ai/types'

export interface RunnerHooks {
  turnId: string
  source: MessageSource
  signal: AbortSignal
  onUpdate(record: ActionRecord): void
  requestConfirmation(req: ConfirmRequest): Promise<boolean>
}

const running = new Map<string, AbortController>()

export function toolSpecs(): ToolSpec[] {
  return ACTIONS.map((a) => ({ name: a.name, description: a.description, parameters: a.parameters }))
}

export function cancelAction(actionId: string): void {
  running.get(actionId)?.abort()
}

/**
 * Executa uma chamada de ferramenta do modelo. Voz e texto passam pelo mesmo caminho,
 * então as mesmas regras de confirmação valem para os dois.
 * Retorna o texto devolvido ao modelo como resultado da ferramenta.
 */
export async function runToolCall(call: ToolCall, hooks: RunnerHooks): Promise<{ record: ActionRecord; output: string }> {
  const id = randomUUID()
  const def = ACTIONS.find((a) => a.name === call.name)
  const record: ActionRecord = {
    id,
    name: call.name,
    label: def?.label ?? call.name,
    summary: '',
    requiresConfirmation: def?.requiresConfirmation ?? false,
    status: 'running'
  }
  const finish = (patch: Partial<ActionRecord>, output: string) => {
    Object.assign(record, patch)
    hooks.onUpdate({ ...record })
    return { record, output }
  }

  if (!def) {
    return finish({ status: 'failed', summary: `Ação desconhecida: ${call.name}`, error: 'Ação não permitida.' },
      `ERRO: a ação "${call.name}" não existe ou não é permitida.`)
  }

  let args: unknown
  try {
    args = def.parse(call.arguments ?? {})
    const { summary } = def.describe(args)
    record.summary = summary
  } catch (err) {
    const msg = (err as Error).message
    return finish({ status: 'failed', summary: def.label, error: msg }, `ERRO: ${msg}`)
  }

  const { summary, details } = def.describe(args)
  if (def.requiresConfirmation) {
    record.status = 'awaiting-confirmation'
    hooks.onUpdate({ ...record })
    const approved = await hooks.requestConfirmation({
      actionId: id, turnId: hooks.turnId, label: def.label, summary, details, source: hooks.source
    })
    if (hooks.signal.aborted) return finish({ status: 'cancelled' }, 'A ação foi cancelada pelo usuário.')
    if (!approved) return finish({ status: 'denied' }, 'O usuário NÃO autorizou esta ação. Ela não foi executada.')
  }

  const controller = new AbortController()
  const onTurnAbort = () => controller.abort()
  hooks.signal.addEventListener('abort', onTurnAbort)
  running.set(id, controller)
  record.status = 'running'
  hooks.onUpdate({ ...record })
  try {
    const result = await def.run(args, { signal: controller.signal })
    if (controller.signal.aborted) return finish({ status: 'cancelled' }, 'A ação foi cancelada pelo usuário.')
    return finish({ status: 'done', result }, `SUCESSO: ${result}`)
  } catch (err) {
    if (controller.signal.aborted) return finish({ status: 'cancelled' }, 'A ação foi cancelada pelo usuário.')
    const msg = (err as Error).message
    return finish({ status: 'failed', error: msg }, `FALHOU: ${msg}`)
  } finally {
    running.delete(id)
    hooks.signal.removeEventListener('abort', onTurnAbort)
  }
}
