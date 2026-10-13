import { describe, expect, it } from 'vitest'
import { Atribuicao } from './atribuicao.ts'

const frase = (id: number, inicioMs: number, fimMs: number) => ({ id, inicioMs, fimMs })

describe('Atribuicao', () => {
  it('devolve o falante verificado, sem revisões', () => {
    expect(new Atribuicao().resolver(frase(0, 0, 3000), 'profissional')).toEqual({ falante: 'profissional', revisoes: [] })
  })

  it('frase curta herda o falante da anterior', () => {
    const atribuicao = new Atribuicao()
    atribuicao.resolver(frase(0, 0, 3000), 'paciente')
    expect(atribuicao.resolver(frase(1, 3200, 3500), null)).toEqual({ falante: 'paciente', revisoes: [] })
  })

  it('frase curta no começo fica sem falante até haver uma verificada', () => {
    const atribuicao = new Atribuicao()
    expect(atribuicao.resolver(frase(0, 0, 300), null).falante).toBeNull()
    expect(atribuicao.resolver(frase(1, 400, 3000), 'profissional').revisoes).toEqual([{ frase: 0, falante: 'profissional' }])
  })

  it('a frase curta passa para a próxima verificada quando está mais perto dela', () => {
    const atribuicao = new Atribuicao()
    atribuicao.resolver(frase(0, 0, 3000), 'profissional')
    atribuicao.resolver(frase(1, 4000, 4300), null)
    expect(atribuicao.resolver(frase(2, 4400, 7000), 'paciente').revisoes).toEqual([{ frase: 1, falante: 'paciente' }])
  })

  it('fica com a anterior quando está mais perto dela ou à mesma distância', () => {
    const atribuicao = new Atribuicao()
    atribuicao.resolver(frase(0, 0, 3000), 'profissional')
    atribuicao.resolver(frase(1, 3100, 3400), null)
    expect(atribuicao.resolver(frase(2, 4400, 7000), 'paciente').revisoes).toEqual([])
    atribuicao.resolver(frase(3, 7200, 7400), null)
    expect(atribuicao.resolver(frase(4, 7500, 9000), 'profissional').revisoes).toEqual([{ frase: 3, falante: 'profissional' }])
    atribuicao.resolver(frase(5, 9100, 9300), null)
    expect(atribuicao.resolver(frase(6, 9400, 12000), 'paciente').revisoes).toEqual([])
  })

  it('decide cada pendente pela vizinha mais próxima e não repete a decisão', () => {
    const atribuicao = new Atribuicao()
    atribuicao.resolver(frase(0, 0, 3000), 'profissional')
    atribuicao.resolver(frase(1, 3100, 3400), null)
    atribuicao.resolver(frase(2, 5000, 5300), null)
    expect(atribuicao.resolver(frase(3, 5400, 8000), 'paciente').revisoes).toEqual([{ frase: 2, falante: 'paciente' }])
    expect(atribuicao.resolver(frase(4, 8100, 11000), 'paciente').revisoes).toEqual([])
  })
})
