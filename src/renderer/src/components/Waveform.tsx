import { useEffect, useState } from 'react'

const SHAPE = [0.35, 0.6, 0.9, 0.55, 1, 0.7, 0.45, 0.8, 0.5, 0.3, 0.65, 0.4]

/** Forma de onda: reage ao nível do microfone ou pulsa enquanto a assistente fala. */
export function Waveform({ level, bars = 9, animated, className = '' }: {
  level: number
  bars?: number
  animated?: boolean
  className?: string
}) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!animated) return
    const id = setInterval(() => setTick((t) => t + 1), 110)
    return () => clearInterval(id)
  }, [animated])

  return (
    <span className={`waveform ${animated ? 'is-animated' : ''} ${className}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => {
        const base = SHAPE[i % SHAPE.length]
        const wobble = animated ? 0.55 + 0.45 * Math.abs(Math.sin((tick + i * 1.7) * 0.9)) : 1
        const energy = animated ? Math.max(0.25, level) : 0.35
        const h = Math.max(0.14, Math.min(1, base * wobble * (0.5 + energy)))
        return <span key={i} style={{ height: `${Math.round(h * 100)}%` }} />
      })}
    </span>
  )
}
