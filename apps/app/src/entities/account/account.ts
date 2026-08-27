export type AccountRole = 'Professional' | 'Patient'

export type TwoFactorRequirement = 'NotApplicable' | 'SetupRequired' | 'ChallengeRequired'

// twoFactorTicket proves the caller already passed register, login, or google for this
// account. The TOTP begin/confirm/challenge endpoints require it; they do not trust the
// accountId URL segment alone.
export interface Account {
  id: string
  email: string
  role: AccountRole
  twoFactorRequirement: TwoFactorRequirement
  twoFactorTicket: string | null
}
