import { msg } from '@lingui/core/macro'
import { i18n } from '@lingui/core'
import type { MessageDescriptor } from '@lingui/core'
import { problemCodes, type ProblemCode } from './problem-codes'

// Elsewhere in this app, the pt-BR source text is the Lingui message id. Here, each
// entry must use msg()'s explicit-id form instead, with `id` set to the exact backend
// `code` string, since that string is the object key this registry is looked up by.
// Keying on ProblemCode (generated from the backend's *ProblemCodes.cs) is what makes a
// code the backend can emit but this registry does not answer a type error instead of a
// silent fall-through to the generic message.
// Stryker disable all
const knownProblemMessages: Record<ProblemCode, MessageDescriptor> = {
  'health.database_unreachable': msg({
    id: 'health.database_unreachable',
    message: 'Banco de dados indisponível no momento.',
  }),
  unexpected_error: msg({
    id: 'unexpected_error',
    message: 'Ocorreu um erro inesperado no servidor.',
  }),
  'auth.email_already_registered': msg({
    id: 'auth.email_already_registered',
    message: 'Este e-mail já está cadastrado.',
  }),
  // The backend returns this same code for both an unknown email and a wrong password.
  // Keep the text generic; it must not hint at which one it was.
  'auth.invalid_credentials': msg({
    id: 'auth.invalid_credentials',
    message: 'E-mail ou senha inválidos.',
  }),
  'auth.google_token_invalid': msg({
    id: 'auth.google_token_invalid',
    message: 'Não foi possível continuar com o Google. Tente novamente.',
  }),
  'validation.invalid_field': msg({
    id: 'validation.invalid_field',
    message: 'Campo inválido: {field}.',
  }),
  'auth.totp_already_enabled': msg({
    id: 'auth.totp_already_enabled',
    message: 'A verificação em duas etapas já está ativada para esta conta.',
  }),
  'auth.totp_not_pending': msg({
    id: 'auth.totp_not_pending',
    message: 'Não há uma configuração de verificação em duas etapas pendente para esta conta.',
  }),
  // The backend returns this same code for a wrong authenticator code and a wrong or
  // already-used backup code. Keep the text generic; it must not hint at which.
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
  // The backend returns this same code for an unknown email and a wrong recovery
  // phrase. Keep the text generic; it must not hint at which part is wrong.
  'auth.invalid_recovery_phrase': msg({
    id: 'auth.invalid_recovery_phrase',
    message: 'E-mail ou frase de recuperação inválidos.',
  }),
  'auth.account_not_found': msg({
    id: 'auth.account_not_found',
    message: 'Conta não encontrada.',
  }),
  'auth.not_a_professional_account': msg({
    id: 'auth.not_a_professional_account',
    message: 'Esta ação está disponível apenas para contas de profissional.',
  }),
  'auth.invalid_verification_state': msg({
    id: 'auth.invalid_verification_state',
    message: 'Não é possível enviar a comprovação com a conta no estado atual.',
  }),
  'auth.not_in_review': msg({
    id: 'auth.not_in_review',
    message: 'Esta conta não está aguardando análise.',
  }),
  'auth.totp_ticket_invalid': msg({
    id: 'auth.totp_ticket_invalid',
    message: 'Sua verificação em duas etapas expirou. Entre novamente.',
  }),
  'staff.unauthorized': msg({
    id: 'staff.unauthorized',
    message: 'Acesso não autorizado.',
  }),
  // The backend returns this same code for a never-issued, an expired, and a
  // reuse-detected refresh token. Keep the text generic; it must not hint at which.
  'auth.refresh_token_invalid': msg({
    id: 'auth.refresh_token_invalid',
    message: 'Sua sessão expirou. Entre novamente.',
  }),
  'auth.access_token_invalid': msg({
    id: 'auth.access_token_invalid',
    message: 'Sua sessão expirou. Entre novamente.',
  }),
  // The backend returns this same code for an expired, an already-claimed, and a
  // wrong-account pairing session, so a stolen QR code cannot be told apart from a live
  // one. Keep the text generic; it must not hint at which.
  'auth.device_pairing_session_not_found': msg({
    id: 'auth.device_pairing_session_not_found',
    message: 'Este código de pareamento não é mais válido. Gere um novo.',
  }),
  // Raised on the primary device, which tried to release access before the new device
  // read the code.
  'auth.device_pairing_payload_not_ready': msg({
    id: 'auth.device_pairing_payload_not_ready',
    message: 'Aguarde o outro dispositivo ler o código antes de liberar o acesso.',
  }),
  // Raised on the new device, which asked for access before the primary device released
  // it.
  'auth.device_pairing_payload_not_delivered': msg({
    id: 'auth.device_pairing_payload_not_delivered',
    message: 'O dispositivo principal ainda não liberou o acesso. Aguarde.',
  }),
}

// Fallback for a backend `code` not in the registry above. The raw code string must
// never appear in the rendered output.
const genericProblemMessage: MessageDescriptor = msg({
  id: 'errors.generic',
  message: 'Ocorreu um erro inesperado. Tente novamente.',
})
// Stryker restore all

// `code` stays a string, not a ProblemCode: it arrives off the wire, so a backend
// deployed ahead of this bundle can send one this build has never heard of. The registry
// is exhaustive against the backend at build time; this guard absorbs the deploy skew.
const answerableCodes: ReadonlySet<string> = new Set(problemCodes)

function isAnswerable(code: string): code is ProblemCode {
  return answerableCodes.has(code)
}

export function translateProblemCode(
  code: string,
  params: Record<string, string>,
  i18nInstance: typeof i18n,
): string {
  const descriptor = isAnswerable(code) ? knownProblemMessages[code] : genericProblemMessage
  return i18nInstance._({ ...descriptor, values: params })
}
