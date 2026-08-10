import { msg } from '@lingui/core/macro'
import { i18n } from '@lingui/core'
import type { MessageDescriptor } from '@lingui/core'

// Elsewhere in this app, the pt-BR source text is the Lingui message id. Here, each
// entry must use msg()'s explicit-id form instead, with `id` set to the exact backend
// `code` string, since that string is the object key this registry is looked up by.
const knownProblemMessages: Record<string, MessageDescriptor> = {
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
}

// Fallback for a backend `code` not in the registry above. The raw code string must
// never appear in the rendered output.
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
