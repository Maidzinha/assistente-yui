// Estado da licença compartilhado entre o processo principal e a interface.

export type LicenseState =
  | 'valid' //       conferida agora com o servidor
  | 'offline' //     servidor fora do ar, mas validada há pouco tempo (período de tolerância)
  | 'missing' //     nenhuma chave neste PC
  | 'invalid' //     chave recusada (expirada, revogada, suspensa, limite de PCs…)
  | 'unconfigured' // o app foi compilado sem os dados do servidor de licenças

export interface LicenseStatus {
  state: LicenseState
  message: string
  code?: string
  /** Chave mascarada, ex.: ABCDE-…-VWXYZ */
  maskedKey?: string
  owner?: string | null
  type?: string
  statusLabel?: string
  expiresAt?: string | null
  lifetime?: boolean
  daysRemaining?: number | null
  maxActivations?: number
  activeDevices?: number
  /** Última validação confirmada pelo servidor (ms). */
  lastCheckAt?: number
  /** Até quando a Yui funciona sem falar com o servidor (ms). */
  offlineUntil?: number
}

export const isLicensed = (s: LicenseStatus): boolean => s.state === 'valid' || s.state === 'offline'
