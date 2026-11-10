import { Icon, type IconName } from './Icon'

export interface Shortcut {
  icon: IconName
  label: string
  hint: string
  prefill: string
}

export const SHORTCUTS: Shortcut[] = [
  { icon: 'folder', label: 'Encontrar um arquivo', hint: 'Fotos, documentos, downloads…', prefill: 'Encontre o arquivo ' },
  { icon: 'globe', label: 'Pesquisar na internet', hint: 'Abre a busca no navegador', prefill: 'Pesquise na internet sobre ' },
  { icon: 'apps', label: 'Abrir um aplicativo', hint: 'Programas instalados no PC', prefill: 'Abra o aplicativo ' }
]

export function Shortcuts({ onPick, compact }: { onPick(s: Shortcut): void; compact?: boolean }) {
  return (
    <ul className={`shortcuts ${compact ? 'shortcuts-compact' : ''}`}>
      {SHORTCUTS.map((s) => (
        <li key={s.label}>
          <button type="button" className="shortcut" onClick={() => onPick(s)}>
            <span className="shortcut-icon"><Icon name={s.icon} size={compact ? 16 : 20} /></span>
            <span className="shortcut-text">
              <strong>{s.label}</strong>
              {!compact && <small>{s.hint}</small>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
