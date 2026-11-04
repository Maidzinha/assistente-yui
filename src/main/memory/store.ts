import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { MemoryItem } from '@shared/types'

/**
 * Memória de longo prazo da Yui: fatos curtos sobre o usuário (nome, gostos, pessoas, planos).
 * Fica só neste PC, em texto, e o usuário pode ver e apagar tudo em Configurações → Memória.
 */
const file = () => join(app.getPath('userData'), 'memoria.json')
const MAX_ITEMS = 200
const MAX_TEXT = 300

let cache: MemoryItem[] | null = null
let writing = Promise.resolve()

async function load(): Promise<MemoryItem[]> {
  if (cache) return cache
  try {
    const raw = JSON.parse(await fs.readFile(file(), 'utf8'))
    cache = Array.isArray(raw) ? raw.filter((m) => m && typeof m.text === 'string') : []
  } catch {
    cache = []
  }
  return cache
}

function persist(): Promise<void> {
  const snapshot = JSON.stringify(cache ?? [], null, 1)
  writing = writing.then(async () => {
    const tmp = `${file()}.tmp`
    await fs.writeFile(tmp, snapshot, 'utf8')
    await fs.rename(tmp, file())
  }).catch((err) => console.error('Falha ao salvar a memória', err))
  return writing
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim()

/** Proteção extra: nunca guardar senhas, cartões ou documentos. */
const SENSITIVE = /\b(senha|password|cart[aã]o de cr[eé]dito|cvv|cpf|rg|token|chave de api|pin)\b|\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/i

/** Coisas que o modelo pequeno tenta guardar à toa: cumprimentos, chegadas e falas sobre a própria Yui. */
const TRIVIAL = /\b(yui|yuri|assistente)\b|\b(chegou|cumprimentou|disse oi|deu oi|mandou oi|esta aqui|voltou agora|acabou de)\b/

export async function listMemories(): Promise<MemoryItem[]> {
  return (await load()).slice().sort((a, b) => a.createdAt - b.createdAt)
}

export async function addMemory(text: string): Promise<{ added: boolean; reason?: string }> {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
  if (!clean) return { added: false, reason: 'texto vazio' }
  if (SENSITIVE.test(clean)) return { added: false, reason: 'parece um dado sensível (senha, documento ou cartão), então não foi guardado' }
  const all = await load()
  const key = norm(clean)
  if (TRIVIAL.test(key)) return { added: false, reason: 'é só um cumprimento ou algo do momento, não precisa guardar' }
  const words = new Set(key.split(' ').filter((w) => w.length > 2))
  const similar = all.find((m) => {
    const other = new Set(norm(m.text).split(' ').filter((w) => w.length > 2))
    const common = [...words].filter((w) => other.has(w)).length
    return common / Math.max(1, Math.min(words.size, other.size)) >= 0.75
  })
  if (similar) return { added: false, reason: `já estava na memória: "${similar.text}"` }
  all.push({ id: randomUUID(), text: clean, createdAt: Date.now() })
  if (all.length > MAX_ITEMS) all.splice(0, all.length - MAX_ITEMS)
  await persist()
  return { added: true }
}

/** Apaga as lembranças que contêm todas as palavras do assunto. */
export async function forgetMatching(about: string): Promise<string[]> {
  const terms = norm(about).split(' ').filter((t) => t.length > 2)
  if (!terms.length) return []
  const all = await load()
  const removed = all.filter((m) => terms.every((t) => norm(m.text).includes(t)))
  cache = all.filter((m) => !removed.includes(m))
  if (removed.length) await persist()
  return removed.map((m) => m.text)
}

export async function removeMemory(id: string): Promise<void> {
  cache = (await load()).filter((m) => m.id !== id)
  await persist()
}

export async function clearMemories(): Promise<void> {
  cache = []
  await persist()
}
