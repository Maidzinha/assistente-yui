import { app } from 'electron'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

export type KnownFolder = 'desktop' | 'documents' | 'downloads' | 'pictures' | 'music' | 'videos' | 'home'

const ALIASES: Record<string, KnownFolder> = {
  desktop: 'desktop', 'área de trabalho': 'desktop', 'area de trabalho': 'desktop',
  documents: 'documents', documentos: 'documents',
  downloads: 'downloads',
  pictures: 'pictures', imagens: 'pictures', fotos: 'pictures',
  music: 'music', música: 'music', musica: 'music', músicas: 'music',
  videos: 'videos', vídeos: 'videos',
  home: 'home', 'pasta pessoal': 'home', usuário: 'home'
}

export function knownFolderPath(folder: KnownFolder): string {
  return folder === 'home' ? homedir() : app.getPath(folder)
}

export function resolveKnownFolder(name: string | undefined): KnownFolder | undefined {
  if (!name) return undefined
  return ALIASES[name.trim().toLowerCase()]
}

/** Raízes onde a assistente pode operar: somente a pasta do usuário e suas pastas conhecidas. */
function allowedRoots(): string[] {
  const roots = new Set<string>([homedir()])
  for (const f of ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'] as const) {
    try { roots.add(app.getPath(f)) } catch { /* pasta inexistente */ }
  }
  return [...roots].map((r) => normalize(r))
}

const PROTECTED_SEGMENTS = ['appdata', '.ssh', '.gnupg', 'ntuser.dat']

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Converte o caminho recebido do modelo em um caminho absoluto permitido.
 * Aceita "~", nomes de pastas conhecidas ("Documentos/relatório.pdf") e caminhos absolutos.
 */
export function resolveUserPath(input: string): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Caminho não informado.')
  let p = input.trim().replace(/^["']|["']$/g, '')
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = join(homedir(), p.slice(1))
  if (!isAbsolute(p)) {
    const [first, ...rest] = p.split(/[\\/]/)
    const known = resolveKnownFolder(first)
    p = known ? join(knownFolderPath(known), ...rest) : join(homedir(), p)
  }
  const abs = resolve(p)
  if (!allowedRoots().some((root) => isInside(abs, root))) {
    throw new Error(`Por segurança, só posso trabalhar dentro da sua pasta de usuário (${homedir()}).`)
  }
  const lower = abs.toLowerCase().split(sep)
  if (lower.some((seg) => PROTECTED_SEGMENTS.includes(seg))) {
    throw new Error('Esse local é protegido (configurações do sistema ou credenciais).')
  }
  return abs
}

const EXECUTABLE_EXT = new Set([
  '.exe', '.bat', '.cmd', '.com', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.msi', '.msp', '.scr', '.pif', '.reg', '.jar', '.hta', '.cpl', '.lnk', '.url', '.appref-ms', '.application'
])

export function isExecutable(path: string): boolean {
  const dot = path.lastIndexOf('.')
  return dot >= 0 && EXECUTABLE_EXT.has(path.slice(dot).toLowerCase())
}
