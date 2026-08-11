export type { Account, AccountRole, TwoFactorRequirement } from './account'
export { deriveEmailPasswordVerifier, deriveEmailSalt } from './password-verifier'
export { deriveRecoveryVerifier } from './recovery-verifier'
export {
  register,
  login,
  continueWithGoogle,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  verifyTotpChallenge,
  requestMagicLink,
  verifyMagicLink,
  recoverAccess,
  registerRecoveryPhrase,
  completeWebAuthnCeremony,
} from './api'
export type {
  RegisterResult,
  LoginResult,
  GoogleAuthResult,
  BeginTotpEnrollmentResult,
  ConfirmTotpEnrollmentResult,
  TotpChallengeResult,
  MagicLinkCeremonyType,
  RequestMagicLinkResult,
  VerifyMagicLinkResult,
  RegisterRecoveryPhraseResult,
  MagicLinkAccount,
  CompleteWebAuthnCeremonyResult,
} from './api'
