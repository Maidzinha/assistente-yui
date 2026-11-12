/**
 * Licença da Yui, conferida no Maidzinha License Manager (aplicativo ASSISTENTE-YUI).
 *
 * - A chave é ativada uma vez por PC (machine_id derivado do MachineGuid do Windows).
 * - A cada abertura e de tempos em tempos a licença é validada de novo no servidor.
 * - Toda resposta é conferida pela assinatura HMAC-SHA256 e pelo nonce enviado.
 * - Sem internet, a Yui continua funcionando por OFFLINE_DAYS desde a última validação.
 */
import { app, BrowserWindow, safeStorage } from 'electron'
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { isLicensed, type LicenseStatus } from '@shared/license'
import { canonicalWithoutSignature } from './canonical'

const SERVER = (import.meta.env.MAIN_VITE_LICENSE_SERVER || 'http://127.0.0.1:8765').replace(/\/+$/, '')
const APP_ID = (import.meta.env.MAIN_VITE_LICENSE_APP_ID || 'ASSISTENTE-YUI').trim().toUpperCase()
const API_KEY = (import.meta.env.MAIN_VITE_LICENSE_API_KEY || '').trim()

const OFFLINE_DAYS = 3
const RECHECK_MS = 30 * 60_000
const TIMEOUT_MS = 10_000

const MESSAGES: Record<string, string> = {
  LICENSE_NOT_FOUND: 'Essa chave não existe para a Assistente Yui. Confira se digitou certinho.',
  LICENSE_EXPIRED: 'Esta licença expirou. Renove para continuar usando a Yui.',
  LICENSE_REVOKED: 'Esta licença foi revogada.',
  LICENSE_SUSPENDED: 'Esta licença está suspensa no momento.',
  MACHINE_LIMIT: 'Esta licença já está em uso no limite de computadores permitido. Desative em outro PC ou fale com o suporte.',
  MACHINE_NOT_ACTIVATED: 'Este computador não está ativado nesta licença.',
  NOT_ACTIVATED: 'A licença ainda não foi ativada.',
  CLIENT_MISMATCH: 'Esta licença está registrada para outro e-mail.',
  MACHINE_ID_REQUIRED: 'Não foi possível identificar este computador.'
}

interface Stored {
  key: string
  email?: string
  lastOkAt?: number
  info?: ServerLicense
}

interface ServerLicense {
  key: string
  type: string
  status: string
  status_label: string
  owner: string | null
  expires_at: string | null
  lifetime: boolean
  days_remaining: number | null
  max_activations: number
  active_devices: number
}

interface ServerReply {
  ok: boolean
  valid?: boolean
  code: string
  message?: string
  license?: ServerLicense
  server_time?: string
}

class NetworkError extends Error {}

const file = () => join(app.getPath('userData'), 'license.dat')
let current: LicenseStatus = { state: 'missing', message: 'Ative sua licença para usar a Yui.' }
let stored: Stored | null = null
let timer: NodeJS.Timeout | null = null
let machineCache: string | null = null

const mask = (k: string) => (k.length <= 12 ? k : `${k.slice(0, 5)}-…-${k.slice(-5)}`)

// ---- Armazenamento local (cifrado com o DPAPI do Windows quando disponível)

async function readStored(): Promise<Stored | null> {
  try {
    const raw = await fs.readFile(file(), 'utf8')
    const [kind, data] = raw.split(':', 2)
    const json = kind === 'enc'
      ? safeStorage.decryptString(Buffer.from(data, 'base64'))
      : Buffer.from(data, 'base64').toString('utf8')
    const s = JSON.parse(json) as Stored
    if (kind !== 'enc') delete s.lastOkAt // sem cifra, não confia na data para uso offline
    return typeof s.key === 'string' ? s : null
  } catch {
    return null
  }
}

async function writeStored(s: Stored | null): Promise<void> {
  stored = s
  if (!s) {
    await fs.rm(file(), { force: true })
    return
  }
  const json = JSON.stringify(s)
  const content = safeStorage.isEncryptionAvailable()
    ? `enc:${safeStorage.encryptString(json).toString('base64')}`
    : `plain:${Buffer.from(json, 'utf8').toString('base64')}`
  const tmp = `${file()}.tmp`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, file())
}

// ---- Identificação do computador

function machineGuid(): Promise<string> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('')
    execFile('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { windowsHide: true, timeout: 5000 }, (err, out) => {
        const m = !err && /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/.exec(out)
        resolve(m ? m[1].toLowerCase() : '')
      })
  })
}

async function machineId(): Promise<string> {
  if (machineCache) return machineCache
  const guid = await machineGuid()
  const base = guid || `${hostname()}|${userInfo().username}`
  machineCache = `YUI-${createHash('sha256').update(`${APP_ID}|${base}`).digest('hex').slice(0, 32)}`
  return machineCache
}

// ---- Comunicação com o servidor

async function call(endpoint: 'activate' | 'validate' | 'deactivate', key: string, email?: string): Promise<ServerReply> {
  const nonce = randomUUID().replace(/-/g, '')
  let res: Response
  try {
    res = await fetch(`${SERVER}/api/license/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Id': APP_ID, 'X-Api-Key': API_KEY },
      body: JSON.stringify({ license_key: key, machine_id: await machineId(), email: email || null, nonce }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch {
    throw new NetworkError('Não foi possível falar com o servidor de licenças.')
  }
  const text = await res.text()
  if (res.status === 401) throw new Error('O servidor de licenças não reconheceu este aplicativo (chave de API inválida).')
  if (res.status === 403 && !text.includes('"signature"')) throw new Error('A Assistente Yui está desativada no servidor de licenças.')
  if (res.status === 429) throw new NetworkError('Muitas tentativas seguidas. Aguarde um minuto e tente de novo.')
  if (res.status >= 500) throw new NetworkError(`O servidor de licenças está com problemas (HTTP ${res.status}).`)

  let reply: ServerReply & { nonce?: string; app_id?: string }
  let signature: string | null
  let canonical: string
  try {
    reply = JSON.parse(text)
    ;({ signature, canonical } = canonicalWithoutSignature(text))
  } catch {
    throw new NetworkError('Resposta inesperada do servidor de licenças.')
  }
  const expected = createHmac('sha256', API_KEY).update(canonical, 'utf8').digest('hex')
  const okSig = !!signature && signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  if (!okSig || reply.nonce !== nonce || reply.app_id !== APP_ID) {
    throw new Error('A resposta do servidor de licenças não é autêntica.')
  }
  return reply
}

// ---- Estado

function fromServer(info: ServerLicense | undefined, extra: Partial<LicenseStatus>): LicenseStatus {
  return {
    state: 'invalid',
    message: '',
    maskedKey: stored ? mask(stored.key) : undefined,
    owner: info?.owner,
    type: info?.type,
    statusLabel: info?.status_label,
    expiresAt: info?.expires_at,
    lifetime: info?.lifetime,
    daysRemaining: info?.days_remaining,
    maxActivations: info?.max_activations,
    activeDevices: info?.active_devices,
    lastCheckAt: stored?.lastOkAt,
    ...extra
  }
}

function setStatus(next: LicenseStatus): LicenseStatus {
  const changed = JSON.stringify(next) !== JSON.stringify(current)
  current = next
  if (changed) {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.webContents.isDestroyed()) w.webContents.send(IPC.licenseChanged, current)
    }
  }
  return current
}

const expiredLocally = (info?: ServerLicense) =>
  !!info?.expires_at && new Date(info.expires_at).getTime() <= Date.now()

async function accept(reply: ServerReply): Promise<LicenseStatus> {
  const s: Stored = { ...stored!, lastOkAt: Date.now(), info: reply.license }
  await writeStored(s)
  return setStatus(fromServer(reply.license, {
    state: 'valid',
    message: 'Licença ativa.',
    code: reply.code,
    lastCheckAt: s.lastOkAt,
    offlineUntil: s.lastOkAt! + OFFLINE_DAYS * 86_400_000
  }))
}

function reject(reply: ServerReply): LicenseStatus {
  return setStatus(fromServer(reply.license, {
    state: 'invalid',
    code: reply.code,
    message: MESSAGES[reply.code] ?? reply.message ?? 'Licença inválida.'
  }))
}

/** Valida a chave guardada no servidor. */
export async function checkLicense(): Promise<LicenseStatus> {
  if (!API_KEY) {
    return setStatus({ state: 'unconfigured', message: 'Esta cópia da Yui foi compilada sem os dados do servidor de licenças.' })
  }
  stored ??= await readStored()
  if (!stored) return setStatus({ state: 'missing', message: 'Ative sua licença para usar a Yui.' })
  try {
    let reply = await call('validate', stored.key, stored.email)
    // O PC foi desvinculado no painel, mas a chave continua boa: tenta ativar de novo.
    if (!reply.valid && reply.code === 'MACHINE_NOT_ACTIVATED') reply = await call('activate', stored.key, stored.email)
    return reply.valid ? accept(reply) : reject(reply)
  } catch (err) {
    const msg = (err as Error).message
    if (err instanceof NetworkError && stored.lastOkAt && !expiredLocally(stored.info)) {
      const until = stored.lastOkAt + OFFLINE_DAYS * 86_400_000
      if (Date.now() < until) {
        return setStatus(fromServer(stored.info, {
          state: 'offline', code: 'OFFLINE', offlineUntil: until,
          message: `${msg} A Yui segue funcionando sem conexão por um tempo.`
        }))
      }
    }
    return setStatus(fromServer(stored.info, { state: 'invalid', code: 'ERROR', message: msg }))
  }
}

export async function activateLicense(key: string, email?: string): Promise<LicenseStatus> {
  if (!API_KEY) return checkLicense()
  const clean = String(key ?? '').trim().toUpperCase().slice(0, 128)
  const mail = String(email ?? '').trim().slice(0, 160) || undefined
  if (clean.length < 4) throw new Error('Digite a chave da licença.')
  let reply: ServerReply
  try {
    reply = await call('activate', clean, mail)
  } catch (err) {
    throw new Error((err as Error).message)
  }
  if (!reply.ok || !reply.valid) {
    throw new Error(MESSAGES[reply.code] ?? reply.message ?? 'Não foi possível ativar a licença.')
  }
  stored = { key: clean, email: mail }
  return accept(reply)
}

/** Libera este PC na licença (para usar em outro computador) e apaga a chave local. */
export async function deactivateLicense(): Promise<LicenseStatus> {
  stored ??= await readStored()
  if (stored && API_KEY) {
    try {
      await call('deactivate', stored.key)
    } catch (err) {
      if (err instanceof NetworkError) throw new Error(`${(err as Error).message} Conecte-se para liberar este PC.`)
      // Chave já inexistente/desativada no servidor: segue apagando localmente.
    }
  }
  await writeStored(null)
  return setStatus({ state: 'missing', message: 'Licença removida deste computador.' })
}

export function getLicenseStatus(): LicenseStatus {
  if (isLicensed(current) && (expiredLocally(stored?.info) ||
      (current.state === 'offline' && current.offlineUntil && Date.now() > current.offlineUntil))) {
    void checkLicense()
    return setStatus({ ...current, state: 'invalid', message: MESSAGES.LICENSE_EXPIRED })
  }
  return current
}

export function assertLicensed(): void {
  if (!isLicensed(getLicenseStatus())) throw new Error('A Yui precisa de uma licença ativa.')
}

/** Primeira checagem na abertura e revalidação periódica. */
export async function startLicensing(): Promise<void> {
  await checkLicense()
  timer ??= setInterval(() => void checkLicense(), RECHECK_MS)
}
