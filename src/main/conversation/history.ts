import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Conversation, ConversationSummary } from '@shared/types'

// Somente texto é salvo. Áudio do microfone nunca é gravado em disco.
const file = () => join(app.getPath('userData'), 'conversations.json')
const MAX_CONVERSATIONS = 100

let cache: Conversation[] | null = null
let writing = Promise.resolve()

async function load(): Promise<Conversation[]> {
  if (cache) return cache
  try {
    cache = JSON.parse(await fs.readFile(file(), 'utf8')) as Conversation[]
  } catch {
    cache = []
  }
  return cache
}

function persist(): Promise<void> {
  const snapshot = JSON.stringify(cache ?? [])
  writing = writing.then(async () => {
    const tmp = `${file()}.tmp`
    await fs.writeFile(tmp, snapshot, 'utf8')
    await fs.rename(tmp, file())
  }).catch((err) => console.error('Falha ao salvar histórico', err))
  return writing
}

export async function listConversations(): Promise<ConversationSummary[]> {
  return (await load())
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      lastSource: c.messages.findLast((m) => m.role === 'user')?.source ?? 'text',
      messageCount: c.messages.length
    }))
}

export async function getConversation(id: string): Promise<Conversation | null> {
  return (await load()).find((c) => c.id === id) ?? null
}

export async function saveConversation(conv: Conversation): Promise<void> {
  const all = await load()
  const idx = all.findIndex((c) => c.id === conv.id)
  if (idx >= 0) all[idx] = conv
  else all.push(conv)
  if (all.length > MAX_CONVERSATIONS) {
    all.sort((a, b) => b.updatedAt - a.updatedAt)
    all.length = MAX_CONVERSATIONS
  }
  await persist()
}

export async function removeConversation(id: string): Promise<void> {
  cache = (await load()).filter((c) => c.id !== id)
  await persist()
}
