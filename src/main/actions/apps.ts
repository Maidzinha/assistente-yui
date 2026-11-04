import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'

export interface AppEntry {
  name: string
  target: string
}

// Aplicativos do Windows sempre disponíveis.
const BUILT_IN: (AppEntry & { aliases: string[] })[] = [
  { name: 'Bloco de Notas', target: 'C:\\Windows\\System32\\notepad.exe', aliases: ['notepad', 'bloco de notas', 'notas'] },
  { name: 'Calculadora', target: 'C:\\Windows\\System32\\calc.exe', aliases: ['calculadora', 'calculator', 'calc'] },
  { name: 'Paint', target: 'C:\\Windows\\System32\\mspaint.exe', aliases: ['paint', 'mspaint'] },
  { name: 'Explorador de Arquivos', target: 'C:\\Windows\\explorer.exe', aliases: ['explorador', 'explorer', 'explorador de arquivos', 'arquivos'] },
  { name: 'Configurações', target: 'ms-settings:', aliases: ['configurações', 'configuracoes', 'settings', 'ajustes'] },
  { name: 'Ferramenta de Captura', target: 'C:\\Windows\\System32\\SnippingTool.exe', aliases: ['captura', 'ferramenta de captura', 'print', 'snipping tool'] }
]

// Nada de terminais ou ferramentas de administração: a assistente não executa comandos arbitrários.
const BLOCKED = /powershell|prompt de comando|command prompt|\bcmd\b|terminal|regedit|editor do registro|uninstall|desinstalar|wsl|bash/i

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

let cache: { at: number; apps: AppEntry[] } | null = null

async function walkShortcuts(dir: string, out: AppEntry[], depth = 0): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory() && depth < 3) await walkShortcuts(full, out, depth + 1)
    else if (e.isFile() && extname(e.name).toLowerCase() === '.lnk') {
      const name = basename(e.name, '.lnk')
      if (!BLOCKED.test(name)) out.push({ name, target: full })
    }
  }
}

export async function listApps(): Promise<AppEntry[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.apps
  const shortcuts: AppEntry[] = []
  await walkShortcuts(join(process.env.ProgramData ?? 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'), shortcuts)
  await walkShortcuts(join(app.getPath('appData'), 'Microsoft\\Windows\\Start Menu\\Programs'), shortcuts)
  const apps = [...BUILT_IN.map(({ name, target }) => ({ name, target })), ...shortcuts]
  cache = { at: Date.now(), apps }
  return apps
}

export async function findApp(query: string): Promise<AppEntry | undefined> {
  const q = norm(query)
  if (!q || BLOCKED.test(q)) return undefined
  const builtIn = BUILT_IN.find((a) => a.aliases.some((alias) => norm(alias) === q))
  if (builtIn) return builtIn
  const apps = await listApps()
  return (
    apps.find((a) => norm(a.name) === q) ??
    apps.find((a) => norm(a.name).startsWith(q)) ??
    apps.find((a) => norm(a.name).includes(q))
  )
}
