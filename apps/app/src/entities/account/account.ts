export type AccountRole = 'Professional' | 'Patient'
export const ESTADOS_VERIFICACAO = ['Pending', 'InReview', 'Active', 'Rejected'] as const

export type TwoFactorRequirement = 'NotApplicable' | 'SetupRequired' | 'ChallengeRequired'

export interface SessionTokens {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: string
}

// twoFactorTicket proves the caller already passed register, login, or google for this
// account. The TOTP begin/confirm/challenge endpoints require it; they do not trust the
// accountId URL segment alone.
export interface Account {
  id: string
  email: string | null
  role: AccountRole
  twoFactorRequirement: TwoFactorRequirement
  twoFactorTicket: string | null
  accessToken: string | null
  refreshToken: string | null
  accessTokenExpiresAt: string | null
}
