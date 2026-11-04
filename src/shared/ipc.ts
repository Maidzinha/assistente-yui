// Nomes dos canais IPC. Mantidos em um só lugar para o preload e o main.
export const IPC = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  secretsInfo: 'secrets:info',
  secretsSet: 'secrets:set',
  providersStatus: 'providers:status',

  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatEvent: 'chat:event',

  historyList: 'history:list',
  historyGet: 'history:get',
  historyRemove: 'history:remove',

  actionConfirmRequest: 'action:confirm-request',
  actionConfirmResponse: 'action:confirm-response',
  actionCancel: 'action:cancel',

  usageGet: 'usage:get',

  avatarPick: 'avatar:pick',
  avatarLoad: 'avatar:load',
  avatarRemove: 'avatar:remove',

  memoryList: 'memory:list',
  memoryRemove: 'memory:remove',
  memoryClear: 'memory:clear',

  voiceTranscribe: 'voice:transcribe',
  voiceSynthesize: 'voice:synthesize'
} as const

export const DEFAULT_SETTINGS = {
  llm: {
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'llama3.1:8b',
    temperature: 0.6
  },
  stt: {
    provider: 'local-whisper',
    baseUrl: 'http://127.0.0.1:8080',
    model: 'whisper-1',
    whisperPython: '',
    whisperModel: 'small',
    // A placa de vídeo costuma ficar ocupada com a IA e a voz.
    whisperDevice: 'cpu'
  },
  tts: {
    provider: 'system',
    voice: '',
    piperPath: '',
    piperModel: '',
    baseUrl: 'http://127.0.0.1:8880/v1',
    model: 'kokoro',
    rate: 1,
    fishVoiceId: '',
    fishModel: 's2.1-pro',
    fishLatency: 'balanced',
    elevenVoiceId: '',
    // Mesmo modelo e ajustes padrão do site da ElevenLabs: o Flash muda muito o timbre de vozes clonadas.
    elevenModel: 'eleven_v4_turbo',
    elevenStability: 0.5,
    elevenSimilarity: 0.75,
    elevenTone: 'none',
    custom: {
      name: 'Voz personalizada',
      xttsPython: '',
      xttsModelDir: '',
      xttsLatents: '',
      xttsDevice: 'cuda',
      rvcEnabled: true,
      rvcPython: '',
      rvcDir: '',
      rvcModel: '',
      rvcIndex: '',
      // Ajuste escolhido ouvindo a voz da Maidzinha (versão “D3”).
      rvcPitch: 3,
      rvcF0Method: 'rmvpe',
      rvcIndexRate: 0.5,
      rvcProtect: 0.33,
      rvcDevice: 'cuda'
    }
  },
  voice: {
    language: 'pt-BR',
    spokenReplies: true,
    speakTextReplies: false,
    autoStopOnSilence: true,
    continuousConversation: true
  },
  avatar: {
    mode: '3d',
    vrmName: ''
  }
} satisfies import('./types').Settings
