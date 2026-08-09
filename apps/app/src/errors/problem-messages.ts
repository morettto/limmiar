import { msg } from '@lingui/core/macro'
import { i18n } from '@lingui/core'
import type { MessageDescriptor } from '@lingui/core'

// ADR-S00.5-07 makes the pt-BR source text itself the Lingui message id
// everywhere else in this app. This registry is a deliberate, narrow
// exception to that default: the backend returns a stable, machine-readable
// `code` string (e.g. "health.database_unreachable") that must be looked up
// directly as a plain object key, so each entry below uses msg()'s
// explicit-id object form with `id` set to the exact backend code string
// instead of letting it default to the source text.
const knownProblemMessages: Record<string, MessageDescriptor> = {
  'health.database_unreachable': msg({
    id: 'health.database_unreachable',
    message: 'Banco de dados indisponível no momento.',
  }),
  unexpected_error: msg({
    id: 'unexpected_error',
    message: 'Ocorreu um erro inesperado no servidor.',
  }),
  // S02-01 backend codes (apps/api/src/Api/Problems/ProblemCodes.cs), surfaced
  // by AuthScreen's register/login/Google flows via the client functions in
  // api/client.ts.
  'auth.email_already_registered': msg({
    id: 'auth.email_already_registered',
    message: 'Este e-mail já está cadastrado.',
  }),
  // Deliberately generic wording: the backend returns this SAME code (and
  // same status/body) for both an unknown e-mail and a wrong password
  // (AccountService.LoginAsync's enumeration mitigation) -- the translated
  // text must not hint at which one it was either.
  'auth.invalid_credentials': msg({
    id: 'auth.invalid_credentials',
    message: 'E-mail ou senha inválidos.',
  }),
  'auth.google_token_invalid': msg({
    id: 'auth.google_token_invalid',
    message: 'Não foi possível continuar com o Google. Tente novamente.',
  }),
  // `field` is interpolated from the backend's `params.field` (e.g. "email",
  // "passwordVerifier") -- not itself translated, since it's a wire-level
  // field name, not user-facing prose.
  'validation.invalid_field': msg({
    id: 'validation.invalid_field',
    message: 'Campo inválido: {field}.',
  }),
  // S02-03 backend codes (apps/api/src/Api/Problems/ProblemCodes.cs), surfaced
  // by TotpSetup/TotpChallenge's enrollment and login-challenge flows.
  'auth.totp_already_enabled': msg({
    id: 'auth.totp_already_enabled',
    message: 'A verificação em duas etapas já está ativada para esta conta.',
  }),
  'auth.totp_not_pending': msg({
    id: 'auth.totp_not_pending',
    message: 'Não há uma configuração de verificação em duas etapas pendente para esta conta.',
  }),
  // Deliberately the same wording for both a wrong authenticator code and a
  // wrong/already-used backup code (AccountService.VerifyTotpChallengeAsync
  // returns the same code for both) -- the message must not hint at which.
  'auth.totp_invalid_code': msg({
    id: 'auth.totp_invalid_code',
    message: 'Código inválido. Verifique o app autenticador ou use um código de backup.',
  }),
  'auth.totp_not_enabled': msg({
    id: 'auth.totp_not_enabled',
    message: 'A verificação em duas etapas ainda não foi ativada para esta conta.',
  }),
  'auth.magic_link_invalid': msg({
    id: 'auth.magic_link_invalid',
    message: 'Este link de acesso não é mais válido. Solicite um novo.',
  }),
  'auth.webauthn_ceremony_failed': msg({
    id: 'auth.webauthn_ceremony_failed',
    message: 'Não foi possível confirmar sua identidade neste dispositivo. Tente novamente.',
  }),
  // S02-06 backend code (apps/api/src/Api/Problems/ProblemCodes.cs), surfaced by
  // RecoveryScreen's recoverAccess() call. Deliberately generic wording, same
  // enumeration-mitigation discipline as auth.invalid_credentials above: the backend
  // returns this SAME code for an unknown e-mail and for a wrong recovery phrase, and the
  // translated text must not hint at which part is wrong -- and must never name which
  // word of the phrase, if any, was incorrect.
  'auth.invalid_recovery_phrase': msg({
    id: 'auth.invalid_recovery_phrase',
    message: 'E-mail ou frase de recuperação inválidos.',
  }),
}

// Fallback for any backend `code` not present in the registry above. Only
// `params` (caller-supplied) is ever interpolated here — the raw unknown
// `code` string itself must never appear in the rendered output.
const genericProblemMessage: MessageDescriptor = msg({
  id: 'errors.generic',
  message: 'Ocorreu um erro inesperado. Tente novamente.',
})

export function translateProblemCode(
  code: string,
  params: Record<string, string>,
  i18nInstance: typeof i18n,
): string {
  const descriptor = knownProblemMessages[code] ?? genericProblemMessage
  return i18nInstance._({ ...descriptor, values: params })
}
