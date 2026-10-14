import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { I18n } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { dynamicActivate, i18n, setLocale } from './i18n'
import { traduzir } from './texto'

describe('traduzir', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })

  it('devolve o texto pronto de um Error como veio, sem passar pelo catálogo', () => {
    const catalogo = { _: vi.fn(() => 'do catálogo') } as unknown as I18n
    expect(traduzir(catalogo, 'Falha do servidor')).toBe('Falha do servidor')
    expect(catalogo._).not.toHaveBeenCalled()
  })

  it('traduz o descritor no idioma ativo, de novo a cada troca', async () => {
    const descritor = msg`Material excluído do seu acervo.`
    expect(traduzir(i18n, descritor)).toBe('Material excluído do seu acervo.')
    await setLocale('en-US')
    expect(traduzir(i18n, descritor)).toBe('Material deleted from your collection.')
    await setLocale('pt-BR')
    expect(traduzir(i18n, descritor)).toBe('Material excluído do seu acervo.')
  })
})
