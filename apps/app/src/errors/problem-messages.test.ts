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

// S02-01 backend codes (apps/api/src/Api/Problems/ProblemCodes.cs) that
// AuthScreen's register/login/Google flows can surface.
describe('translateProblemCode — S02-01 auth codes', () => {
  it('translates auth.email_already_registered', () => {
    const i18nInstance = setupI18n({
      locale: 'pt-BR',
      messages: { 'pt-BR': { 'auth.email_already_registered': 'Este e-mail já está cadastrado.' } },
    })

    expect(translateProblemCode('auth.email_already_registered', {}, i18nInstance)).toBe(
      'Este e-mail já está cadastrado.',
    )
  })

  it('translates auth.invalid_credentials', () => {
    const i18nInstance = setupI18n({
      locale: 'pt-BR',
      messages: { 'pt-BR': { 'auth.invalid_credentials': 'E-mail ou senha inválidos.' } },
    })

    expect(translateProblemCode('auth.invalid_credentials', {}, i18nInstance)).toBe('E-mail ou senha inválidos.')
  })

  it('translates auth.google_token_invalid', () => {
    const i18nInstance = setupI18n({
      locale: 'pt-BR',
      messages: {
        'pt-BR': { 'auth.google_token_invalid': 'Não foi possível continuar com o Google. Tente novamente.' },
      },
    })

    expect(translateProblemCode('auth.google_token_invalid', {}, i18nInstance)).toBe(
      'Não foi possível continuar com o Google. Tente novamente.',
    )
  })

  it('translates validation.invalid_field, interpolating the offending field name', () => {
    const i18nInstance = setupI18n({
      locale: 'pt-BR',
      messages: { 'pt-BR': { 'validation.invalid_field': 'Campo inválido: {field}.' } },
    })

    expect(translateProblemCode('validation.invalid_field', { field: 'email' }, i18nInstance)).toBe(
      'Campo inválido: email.',
    )
  })
})
