import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import type { Nota } from '../../entities/nota/nota'
import type { Transcricao } from '../../entities/transcricao/transcricao'
import { EstadoDoAtendimento } from './EstadoDoAtendimento'
import type { Prontuario } from './abrir-prontuario'
import { ProntuarioContext } from './prontuario-context'

const transcricao = (id: string) => ({ id }) as Transcricao
const nota = (atendimentoId: string, estado: Nota['estado']) => ({ atendimentoId, estado }) as Nota

function montar(transcricoes: Transcricao[], notas: Nota[]) {
  render(<I18nProvider i18n={i18n}><ProntuarioContext.Provider value={{ prontuario: { transcricoes, notas } as Prontuario, recarregar: async () => {} }}>
    <EstadoDoAtendimento atendimentoId="a1" />
  </ProntuarioContext.Provider></I18nProvider>)
}

describe('EstadoDoAtendimento', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  afterEach(cleanup)

  it.each([
    ['sessão sem transcrição nem nota', [], [], 'Sem transcrição · Nota pendente'],
    ['transcrição salva e nota em rascunho', [transcricao('a1')], [nota('a1', 'pendente')], 'Transcrição salva · Nota pendente'],
    ['transcrição salva e nota assinada', [transcricao('a1')], [nota('a1', 'assinada')], 'Transcrição salva · Nota assinada'],
  ])('%s', (_caso, transcricoes, notas, texto) => {
    montar(transcricoes, notas)
    expect(screen.getByText(texto)).toBeTruthy()
  })

  it('ignora transcrição e nota assinada de outra sessão', () => {
    montar([transcricao('a2')], [nota('a2', 'assinada')])
    expect(screen.getByText('Sem transcrição · Nota pendente')).toBeTruthy()
  })

  it('sem o provedor do prontuário falha alto em vez de assumir um estado', () => {
    expect(() => render(<I18nProvider i18n={i18n}><EstadoDoAtendimento atendimentoId="a1" /></I18nProvider>)).toThrow('useProntuario precisa de um <ProntuarioProvider> acima.')
  })
})
