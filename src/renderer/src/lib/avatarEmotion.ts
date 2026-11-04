/**
 * Converte as marcações de emoção da fala ([laughing], [sighing]…) em expressões do modelo VRM.
 * As expressões padrão do VRM são: happy, angry, sad, relaxed e surprised.
 */
export type AvatarEmotion = 'neutral' | 'happy' | 'angry' | 'sad' | 'relaxed' | 'surprised'

const MAP: Record<string, [AvatarEmotion, number]> = {
  laughing: ['happy', 1], chuckling: ['happy', 0.8], giggles: ['happy', 0.9], playful: ['happy', 0.7],
  excited: ['happy', 1], cheerfully: ['happy', 0.8], happy: ['happy', 0.9], humming: ['happy', 0.5], singing: ['happy', 0.6],
  sighing: ['sad', 0.5], sad: ['sad', 0.9], 'voice breaking': ['sad', 1], tired: ['sad', 0.5], weak: ['sad', 0.6],
  sniffling: ['sad', 0.8], bored: ['sad', 0.35], coughing: ['sad', 0.3],
  angry: ['angry', 0.9], scoffing: ['angry', 0.45], menacing: ['angry', 0.7],
  gasping: ['surprised', 1], surprised: ['surprised', 1], 'sharp exhale': ['surprised', 0.5],
  softly: ['relaxed', 0.6], whispering: ['relaxed', 0.5], warmly: ['relaxed', 0.7], slowly: ['relaxed', 0.4],
  'sleepy drowsy voice': ['relaxed', 1], yawning: ['relaxed', 0.9]
}

/** Emoção da frase pela primeira marcação reconhecida (ou neutra). */
export function emotionOf(sentence: string | null | undefined): { emotion: AvatarEmotion; weight: number } {
  if (!sentence) return { emotion: 'neutral', weight: 0 }
  for (const m of sentence.matchAll(/\[([a-z]+(?:[ -][a-z]+){0,2})\]/g)) {
    const hit = MAP[m[1]]
    if (hit) return { emotion: hit[0], weight: hit[1] }
  }
  // Sem marcação: um sorrisinho leve em exclamações e risadas escritas.
  if (/(hehe|haha|kkk|rsrs)/i.test(sentence)) return { emotion: 'happy', weight: 0.6 }
  if (/!/.test(sentence)) return { emotion: 'happy', weight: 0.3 }
  return { emotion: 'neutral', weight: 0 }
}
