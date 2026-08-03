import { describe, expect, it } from 'vitest'
import { setupI18n } from '@lingui/core'
import { translateProblemCode } from './problem-messages'

describe('translateProblemCode', () => {
  it('renders the translated, interpolated message for a known backend code', () => {
    const i18nInstance = setupI18n({
      locale: 'pt-BR',
      messages: {
        'pt-BR': {
          'health.database_unreachable': 'Banco de dados indisponível: {reason}',
        },
      },
    })

    const result = translateProblemCode('health.database_unreachable', { reason: 'timeout' }, i18nInstance)

    expect(result).toBe('Banco de dados indisponível: timeout')
  })

  it('falls back to the generic translated message for an unknown/garbage code', () => {
    const i18nInstance = setupI18n({
      locale: 'pt-BR',
      messages: {
        'pt-BR': {
          'errors.generic': 'Ocorreu um erro inesperado. Tente novamente.',
        },
      },
    })

    const result = translateProblemCode('this-code-does-not-exist', {}, i18nInstance)

    expect(result).toBe('Ocorreu um erro inesperado. Tente novamente.')
  })

  it('never leaks the raw unknown code into the fallback string', () => {
    const i18nInstance = setupI18n({
      locale: 'pt-BR',
      messages: {
        'pt-BR': {
          'errors.generic': 'Ocorreu um erro inesperado. Tente novamente.',
        },
      },
    })

    const rawCode = 'totally-unrecognized-backend-code-xyz'
    const result = translateProblemCode(rawCode, {}, i18nInstance)

    expect(result).not.toContain(rawCode)
  })
})
