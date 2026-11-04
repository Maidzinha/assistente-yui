/**
 * Marcações de emoção da voz (ElevenLabs v3/v4), como [excited], [chuckles] ou [short pause].
 * Vão para a síntese de voz, mas não aparecem no texto da conversa.
 */

/** Uma a três palavras minúsculas entre colchetes que não sejam um link [texto](url). */
const TAG_RE = /\[[a-z]+(?:[ -][a-z]+){0,2}\](?!\()[ \t]?/g

export function stripVoiceTags(text: string): string {
  return text.replace(TAG_RE, '').replace(/[ \t]{2,}/g, ' ')
}

export function startsWithVoiceTag(text: string): boolean {
  return /^\s*\[[a-z]+(?:[ -][a-z]+){0,2}\]/.test(text)
}

/** Modelos que interpretam as marcações em vez de lê-las em voz alta. */
export function modelUnderstandsTags(provider: string, model: string): boolean {
  return provider === 'elevenlabs' && /^eleven_v[34]/.test(model || 'eleven_v4')
}
