import { describe, expect, it } from 'vitest'
import { falhaDe, FalhaServicoInsight } from './falha-insight'

describe('classificação das falhas do copiloto', () => {
  it.each(['nao_liberado', 'fora'] as const)('falha de serviço %s mantém a categoria', (falha) => {
    expect(falhaDe(new FalhaServicoInsight(falha))).toBe(falha)
  })
  it.each([new Error('resposta inválida'), new SyntaxError('json'), 'texto', null])('qualquer outro erro vale só para a fala (%#)', (erro) => {
    expect(falhaDe(erro)).toBe('sem_analise')
  })
})
