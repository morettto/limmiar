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
