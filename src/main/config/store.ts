import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS } from '@shared/ipc'
import type { SecretKey, SecretsInfo, Settings } from '@shared/types'

const settingsFile = () => join(app.getPath('userData'), 'settings.json')
const secretsFile = () => join(app.getPath('userData'), 'secrets.json')

let cached: Settings | null = null

function merge(base: Settings, partial: Partial<Settings>): Settings {
  return {
    llm: { ...base.llm, ...partial.llm },
    stt: { ...base.stt, ...partial.stt },
    tts: { ...base.tts, ...partial.tts, custom: { ...base.tts.custom, ...partial.tts?.custom } },
    voice: { ...base.voice, ...partial.voice },
    avatar: { ...base.avatar, ...partial.avatar }
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, path)
}

export async function getSettings(): Promise<Settings> {
  if (cached) return cached
  try {
    const raw = JSON.parse(await fs.readFile(settingsFile(), 'utf8'))
    cached = merge(DEFAULT_SETTINGS, raw)
  } catch {
    cached = merge(DEFAULT_SETTINGS, {})
  }
  return cached
}

export async function saveSettings(next: Settings): Promise<Settings> {
  cached = merge(DEFAULT_SETTINGS, next)
  await writeJson(settingsFile(), cached)
  return cached
}

// ---- Segredos (chaves de API opcionais), cifrados com o DPAPI do Windows via safeStorage.

type SecretsFile = Partial<Record<SecretKey, string>>

async function readSecrets(): Promise<SecretsFile> {
  try {
    return JSON.parse(await fs.readFile(secretsFile(), 'utf8'))
  } catch {
    return {}
  }
}

export async function setSecret(key: SecretKey, value: string | null): Promise<void> {
  const secrets = await readSecrets()
  if (!value) {
    delete secrets[key]
  } else {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('A criptografia do sistema não está disponível; a chave não foi salva.')
    }
    secrets[key] = safeStorage.encryptString(value).toString('base64')
  }
  await writeJson(secretsFile(), secrets)
}

export async function getSecret(key: SecretKey): Promise<string | undefined> {
  const stored = (await readSecrets())[key]
  if (!stored || !safeStorage.isEncryptionAvailable()) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return undefined
  }
}

export async function getSecretsInfo(): Promise<SecretsInfo> {
  const s = await readSecrets()
  return {
    llmApiKey: Boolean(s.llmApiKey),
    sttApiKey: Boolean(s.sttApiKey),
    ttsApiKey: Boolean(s.ttsApiKey),
    elevenApiKey: Boolean(s.elevenApiKey),
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }
}
