import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Processo Python local que expõe um serviço HTTP em 127.0.0.1 (XTTS, RVC…). */
export interface WorkerSpec {
  name: string
  python: string
  script: string
  args: string[]
  port: number
  /** Tempo máximo para carregar o modelo. */
  startTimeoutMs: number
}

export type WorkerState =
  | { status: 'off' }
  | { status: 'starting' }
  | { status: 'ready' }
  | { status: 'failed'; error: string }

interface Running {
  key: string
  proc: ChildProcess
  ready: Promise<string>
  state: WorkerState
}

const workers = new Map<string, Running>()

export function workerScript(file: string): string {
  // out/main/index.js → raiz do projeto; no app empacotado, ao lado dos recursos.
  const candidates = [
    join(__dirname, '..', '..', 'voice-workers', file),
    join(process.resourcesPath ?? '', 'voice-workers', file),
    join(app.getAppPath(), 'voice-workers', file)
  ]
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}

export function workerLog(name: string): string {
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  return join(dir, `voz-${name}.log`)
}

export function workerState(name: string): WorkerState {
  return workers.get(name)?.state ?? { status: 'off' }
}

async function ping(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) })
    return res.ok
  } catch {
    return false
  }
}

/** Inicia (ou reaproveita) o worker e devolve a URL base quando ele estiver pronto. */
export function ensureWorker(spec: WorkerSpec): Promise<string> {
  const key = JSON.stringify(spec)
  const current = workers.get(spec.name)
  if (current && current.key === key && current.state.status !== 'failed' && current.proc.exitCode === null) {
    return current.ready
  }
  stopWorker(spec.name)

  const url = `http://127.0.0.1:${spec.port}`
  const log = workerLog(spec.name)
  // Argumentos fixos montados pelo app; nada vem do modelo de IA.
  const proc = spawn(
    spec.python,
    [spec.script, ...spec.args, '--port', String(spec.port), '--parent-pid', String(process.pid), '--log', log],
    { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }
  )
  let stderr = ''
  proc.stderr?.on('data', (d) => (stderr = (stderr + d.toString()).slice(-3000)))

  const entry: Running = { key, proc, state: { status: 'starting' }, ready: Promise.resolve(url) }
  const fail = (error: string) => {
    entry.state = { status: 'failed', error }
    return new Error(error)
  }
  entry.ready = new Promise<string>((resolve, reject) => {
    const deadline = Date.now() + spec.startTimeoutMs
    let exited = false
    proc.on('error', (err) => { exited = true; reject(fail(`Não foi possível iniciar o Python (${spec.python}): ${err.message}`)) })
    proc.on('exit', (code) => {
      exited = true
      const tail = stderr.trim().split('\n').slice(-4).join(' ').slice(-600)
      reject(fail(`O serviço de voz “${spec.name}” fechou (código ${code}). ${tail} Veja ${log}.`))
    })
    const poll = async () => {
      if (exited) return
      if (await ping(url)) {
        entry.state = { status: 'ready' }
        resolve(url)
      } else if (Date.now() > deadline) {
        proc.kill()
        reject(fail(`O serviço de voz “${spec.name}” demorou demais para carregar. Veja ${log}.`))
      } else setTimeout(poll, 600)
    }
    void poll()
  })
  entry.ready.catch(() => { /* o estado já registra a falha */ })
  workers.set(spec.name, entry)
  return entry.ready
}

export function stopWorker(name: string): void {
  const w = workers.get(name)
  if (w && w.proc.exitCode === null) w.proc.kill()
  workers.delete(name)
}

export function stopAllWorkers(): void {
  for (const name of [...workers.keys()]) stopWorker(name)
}
