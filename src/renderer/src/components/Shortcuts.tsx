import { Icon, type IconName } from './Icon'

export interface Shortcut {
  icon: IconName
  label: string
  prefill: string
}

export const SHORTCUTS: Shortcut[] = [
  { icon: 'folder', label: 'Encontrar um arquivo', prefill: 'Encontre o arquivo ' },
  { icon: 'globe', label: 'Pesquisar na internet', prefill: 'Pesquise na internet sobre ' },
  { icon: 'apps', label: 'Abrir um aplicativo', prefill: 'Abra o aplicativo ' }
]

export function Shortcuts({ onPick, compact }: { onPick(s: Shortcut): void; compact?: boolean }) {
  return (
    <ul className={`shortcuts ${compact ? 'shortcuts-compact' : ''}`}>
      {SHORTCUTS.map((s) => (
        <li key={s.label}>
          <button type="button" className="row-card shortcut" onClick={() => onPick(s)}>
            <Icon name={s.icon} size={24} className="row-icon" />
            <span>{s.label}</span>
            {!compact && <Icon name="chevron" size={20} className="row-chevron" />}
          </button>
        </li>
      ))}
    </ul>
  )
}
