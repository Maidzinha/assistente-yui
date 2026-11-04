import { shell } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { addMemory, forgetMatching } from '../memory/store'
import { findApp, listApps } from './apps'
import { isExecutable, knownFolderPath, resolveKnownFolder, resolveUserPath, type KnownFolder } from './paths'

export interface ActionContext {
  signal: AbortSignal
}

export interface ActionDefinition<A = Record<string, unknown>> {
  name: string
  label: string
  description: string
  parameters: Record<string, unknown>
  /** Ações que alteram arquivos ou saem do computador sempre pedem confirmação. */
  requiresConfirmation: boolean
  parse(raw: Record<string, unknown>): A
  describe(args: A): { summary: string; details: string[] }
  run(args: A, ctx: ActionContext): Promise<string>
}

const str = (raw: Record<string, unknown>, key: string, required = true): string => {
  const v = raw[key]
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (required) throw new Error(`Parâmetro "${key}" ausente.`)
  return ''
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new Error('Ação cancelada.')
}

async function exists(p: string) {
  return fs.stat(p).then(() => true, () => false)
}

function normalizeText(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'appdata', '$recycle.bin', '.cache', '.vscode', '.npm'])

// ---------------------------------------------------------------------------

const findFiles: ActionDefinition<{ query: string; location?: KnownFolder }> = {
  name: 'find_files',
  label: 'Encontrar arquivos',
  description:
    'Procura arquivos e pastas pelo nome nas pastas do usuário. Use location para limitar (desktop, documents, downloads, pictures, music, videos, home).',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Parte do nome do arquivo ou pasta' },
      location: { type: 'string', enum: ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos', 'home'] }
    },
    required: ['query']
  },
  requiresConfirmation: false,
  parse: (raw) => ({ query: str(raw, 'query'), location: resolveKnownFolder(str(raw, 'location', false)) }),
  describe: ({ query, location }) => ({
    summary: `Procurando “${query}”${location ? ` em ${location}` : ' nas suas pastas'}`,
    details: []
  }),
  async run({ query, location }, { signal }) {
    const roots = location
      ? [knownFolderPath(location)]
      : (['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'] as const).map(knownFolderPath)
    const terms = normalizeText(query).split(/\s+/).filter(Boolean)
    const results: string[] = []
    const queue: { dir: string; depth: number }[] = [...new Set(roots)].map((dir) => ({ dir, depth: 0 }))
    let visited = 0
    while (queue.length && results.length < 25 && visited < 6000) {
      throwIfAborted(signal)
      const { dir, depth } = queue.shift()!
      visited++
      let entries: import('node:fs').Dirent[]
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { continue }
      for (const e of entries) {
        const full = join(dir, e.name)
        const name = normalizeText(e.name)
        if (terms.every((t) => name.includes(t))) results.push(e.isDirectory() ? `${full}\\` : full)
        if (e.isDirectory() && depth < 7 && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name.toLowerCase())) {
          queue.push({ dir: full, depth: depth + 1 })
        }
      }
    }
    if (!results.length) return `Nenhum arquivo encontrado para “${query}”.`
    return `Encontrei ${results.length} resultado(s):\n${results.join('\n')}`
  }
}

const openFolder: ActionDefinition<{ path: string }> = {
  name: 'open_folder',
  label: 'Abrir pasta',
  description: 'Abre uma pasta no Explorador de Arquivos. Aceita caminhos absolutos ou nomes como "Downloads".',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  requiresConfirmation: false,
  parse: (raw) => {
    const p = str(raw, 'path')
    const known = resolveKnownFolder(p)
    return { path: known ? knownFolderPath(known) : resolveUserPath(p) }
  },
  describe: ({ path }) => ({ summary: `Abrindo a pasta ${path}`, details: [] }),
  async run({ path }) {
    const stat = await fs.stat(path).catch(() => null)
    if (!stat?.isDirectory()) throw new Error(`A pasta não existe: ${path}`)
    const err = await shell.openPath(path)
    if (err) throw new Error(err)
    return `Pasta aberta: ${path}`
  }
}

const openFile: ActionDefinition<{ path: string }> = {
  name: 'open_file',
  label: 'Abrir arquivo',
  description: 'Abre um documento, imagem, vídeo ou outro arquivo com o programa padrão. Não abre executáveis.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  requiresConfirmation: false,
  parse: (raw) => {
    const path = resolveUserPath(str(raw, 'path'))
    if (isExecutable(path)) throw new Error('Por segurança, não abro programas ou scripts como arquivos. Use “abrir aplicativo”.')
    return { path }
  },
  describe: ({ path }) => ({ summary: `Abrindo ${basename(path)}`, details: [path] }),
  async run({ path }) {
    const stat = await fs.stat(path).catch(() => null)
    if (!stat?.isFile()) throw new Error(`O arquivo não existe: ${path}`)
    const err = await shell.openPath(path)
    if (err) throw new Error(err)
    return `Arquivo aberto: ${path}`
  }
}

const launchApp: ActionDefinition<{ name: string }> = {
  name: 'launch_app',
  label: 'Abrir aplicativo',
  description:
    'Inicia um aplicativo instalado pelo nome (por exemplo "Bloco de Notas", "Calculadora", "Spotify"). Só inicia aplicativos do Menu Iniciar ou da lista padrão; nunca terminais.',
  parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  requiresConfirmation: false,
  parse: (raw) => ({ name: str(raw, 'name') }),
  describe: ({ name }) => ({ summary: `Abrindo o aplicativo “${name}”`, details: [] }),
  async run({ name }, { signal }) {
    const match = await findApp(name)
    throwIfAborted(signal)
    if (!match) {
      const some = (await listApps()).slice(0, 15).map((a) => a.name).join(', ')
      throw new Error(`Não encontrei um aplicativo permitido chamado “${name}”. Alguns disponíveis: ${some}`)
    }
    if (match.target.startsWith('ms-settings:') || match.target.startsWith('shell:')) {
      await shell.openExternal(match.target)
    } else {
      const err = await shell.openPath(match.target)
      if (err) throw new Error(err)
    }
    return `Aplicativo iniciado: ${match.name}`
  }
}

const webSearch: ActionDefinition<{ query: string }> = {
  name: 'web_search',
  label: 'Pesquisar na internet',
  description: 'Abre uma pesquisa na web no navegador padrão. Você não recebe os resultados; apenas abre a página.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  requiresConfirmation: true,
  parse: (raw) => ({ query: str(raw, 'query') }),
  describe: ({ query }) => ({
    summary: `Pesquisar “${query}” no navegador`,
    details: ['A consulta será enviada ao buscador (ação externa).', `https://www.google.com/search?q=${encodeURIComponent(query)}`]
  }),
  async run({ query }) {
    await shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(query)}`)
    return `Pesquisa aberta no navegador: ${query}`
  }
}

const openWebsite: ActionDefinition<{ url: string }> = {
  name: 'open_website',
  label: 'Abrir site',
  description: 'Abre um endereço https no navegador padrão.',
  parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  requiresConfirmation: true,
  parse: (raw) => {
    let url = str(raw, 'url')
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Somente endereços web são permitidos.')
    return { url: parsed.toString() }
  },
  describe: ({ url }) => ({ summary: `Abrir ${new URL(url).hostname} no navegador`, details: [url] }),
  async run({ url }) {
    await shell.openExternal(url)
    return `Site aberto: ${url}`
  }
}

const createFolder: ActionDefinition<{ path: string }> = {
  name: 'create_folder',
  label: 'Criar pasta',
  description: 'Cria uma nova pasta.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  requiresConfirmation: true,
  parse: (raw) => ({ path: resolveUserPath(str(raw, 'path')) }),
  describe: ({ path }) => ({ summary: `Criar a pasta “${basename(path)}”`, details: [`Local: ${dirname(path)}`] }),
  async run({ path }) {
    if (await exists(path)) throw new Error(`Já existe algo com esse nome: ${path}`)
    await fs.mkdir(path, { recursive: true })
    return `Pasta criada: ${path}`
  }
}

const moveFile: ActionDefinition<{ source: string; destinationFolder: string }> = {
  name: 'move_file',
  label: 'Mover arquivo',
  description: 'Move um arquivo ou pasta para outra pasta.',
  parameters: {
    type: 'object',
    properties: { source: { type: 'string' }, destinationFolder: { type: 'string' } },
    required: ['source', 'destinationFolder']
  },
  requiresConfirmation: true,
  parse: (raw) => ({
    source: resolveUserPath(str(raw, 'source')),
    destinationFolder: resolveUserPath(str(raw, 'destinationFolder'))
  }),
  describe: ({ source, destinationFolder }) => ({
    summary: `Mover “${basename(source)}”`,
    details: [`De: ${source}`, `Para: ${join(destinationFolder, basename(source))}`]
  }),
  async run({ source, destinationFolder }) {
    if (!(await exists(source))) throw new Error(`Não encontrei: ${source}`)
    const dest = join(destinationFolder, basename(source))
    if (await exists(dest)) throw new Error(`Já existe um item com esse nome no destino: ${dest}`)
    await fs.mkdir(destinationFolder, { recursive: true })
    try {
      await fs.rename(source, dest)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
      await fs.cp(source, dest, { recursive: true, errorOnExist: true })
      await fs.rm(source, { recursive: true })
    }
    return `Movido para: ${dest}`
  }
}

const renameFile: ActionDefinition<{ path: string; newName: string }> = {
  name: 'rename_file',
  label: 'Renomear',
  description: 'Renomeia um arquivo ou pasta, mantendo-o no mesmo lugar.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, newName: { type: 'string' } },
    required: ['path', 'newName']
  },
  requiresConfirmation: true,
  parse: (raw) => {
    const newName = str(raw, 'newName')
    if (/[\\/:*?"<>|]/.test(newName)) throw new Error('O novo nome contém caracteres inválidos.')
    return { path: resolveUserPath(str(raw, 'path')), newName }
  },
  describe: ({ path, newName }) => ({
    summary: `Renomear “${basename(path)}” para “${newName}”`,
    details: [`Local: ${dirname(path)}`]
  }),
  async run({ path, newName }) {
    if (!(await exists(path))) throw new Error(`Não encontrei: ${path}`)
    const dest = join(dirname(path), newName)
    if (await exists(dest)) throw new Error(`Já existe um item chamado “${newName}”.`)
    await fs.rename(path, dest)
    return `Renomeado para: ${dest}`
  }
}

const deleteFile: ActionDefinition<{ path: string }> = {
  name: 'delete_file',
  label: 'Enviar para a Lixeira',
  description: 'Envia um arquivo ou pasta para a Lixeira do Windows (pode ser restaurado).',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  requiresConfirmation: true,
  parse: (raw) => ({ path: resolveUserPath(str(raw, 'path')) }),
  describe: ({ path }) => ({
    summary: `Enviar “${basename(path)}” para a Lixeira`,
    details: [path, 'Você poderá restaurá-lo pela Lixeira do Windows.']
  }),
  async run({ path }) {
    if (!(await exists(path))) throw new Error(`Não encontrei: ${path}`)
    await shell.trashItem(path)
    return `Enviado para a Lixeira: ${path}`
  }
}

/** Lista explícita de operações permitidas. Nada fora daqui pode ser executado pelo modelo. */
// ---- Memória da Yui (só texto, neste PC; o usuário vê e apaga em Configurações → Memória).

const remember: ActionDefinition<{ fact: string }> = {
  name: 'remember',
  label: 'Guardar na memória',
  description:
    'Guarda um fato NOVO e duradouro que o usuário contou sobre a própria vida (como quer ser chamado, gostos, rotina, pessoas e pets, datas importantes, planos). ' +
    'Não use para cumprimentos, perguntas, pedidos ou o que ele está fazendo agora. ' +
    'Escreva em terceira pessoa e em português, por exemplo "Gosta de jogar Minecraft à noite". Nunca guarde senhas, documentos, cartões ou dados de saúde.',
  parameters: {
    type: 'object',
    properties: { fact: { type: 'string', description: 'O fato, curto e em terceira pessoa' } },
    required: ['fact']
  },
  requiresConfirmation: false,
  parse: (raw) => ({ fact: str(raw, 'fact') }),
  describe: ({ fact }) => ({ summary: `Lembrar: “${fact}”`, details: [] }),
  async run({ fact }) {
    const r = await addMemory(fact)
    // Não é erro: só não precisava guardar. Assim o card não aparece como falha na conversa.
    if (!r.added) return `não precisou guardar (${r.reason})`
    return `guardado na memória: "${fact}"`
  }
}

const forget: ActionDefinition<{ about: string }> = {
  name: 'forget',
  label: 'Esquecer da memória',
  description: 'Apaga da memória as lembranças sobre um assunto, quando o usuário pedir para esquecer algo ou quando um fato guardado mudou.',
  parameters: {
    type: 'object',
    properties: { about: { type: 'string', description: 'Palavras do assunto a esquecer, por exemplo "jogo favorito"' } },
    required: ['about']
  },
  requiresConfirmation: false,
  parse: (raw) => ({ about: str(raw, 'about') }),
  describe: ({ about }) => ({ summary: `Esquecer o que for sobre “${about}”`, details: [] }),
  async run({ about }) {
    const removed = await forgetMatching(about)
    if (!removed.length) return 'nada sobre isso estava na memória'
    return `esquecido: ${removed.map((t) => `"${t}"`).join('; ')}`
  }
}

export const ACTIONS: ActionDefinition<any>[] = [
  findFiles, openFolder, openFile, launchApp, webSearch, openWebsite, createFolder, moveFile, renameFile, deleteFile,
  remember, forget
]
