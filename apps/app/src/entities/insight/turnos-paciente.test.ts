import { describe, expect, it } from 'vitest'
import { selecionarFalasPaciente } from './falas-paciente'
import { selecionarTurnosPaciente } from './turnos-paciente'

const papeis = { p: 'paciente', t: 'voce' } as const

describe('fala inteira do paciente', () => {
  it('junta as frases quando o profissional retoma a palavra, ancorada em cada frase', () => {
    const palavras = [
      { texto: 'Tenho medo quando vejo um homem no passeio.', locutor: 'p', inicioMs: 0, fimMs: 1000 },
      { texto: 'Desde o assalto.', locutor: 'p', inicioMs: 1100, fimMs: 1600 },
      { texto: 'Entendo.', locutor: 't', inicioMs: 2000, fimMs: 2400 },
    ]
    const falas = selecionarFalasPaciente(palavras, papeis, 2500)
    expect(selecionarTurnosPaciente(palavras, papeis, 2500, falas)).toEqual([{
      id: 'turno:0:p', frase: 'Tenho medo quando vejo um homem no passeio. Desde o assalto.', contexto: [], ancoras: ['0:p', '1100:p'],
    }])
  })
  it('espera o silêncio estável e ignora fala de uma frase só', () => {
    const palavras = [
      { texto: 'Não durmo.', locutor: 'p', inicioMs: 0, fimMs: 500 },
      { texto: 'Acordo cedo.', locutor: 'p', inicioMs: 600, fimMs: 1000 },
    ]
    const falas = selecionarFalasPaciente(palavras, papeis, 1100)
    expect(selecionarTurnosPaciente(palavras, papeis, 3499, falas)).toEqual([])
    expect(selecionarTurnosPaciente(palavras, papeis, 3500, falas)).toHaveLength(1)
    const uma = [palavras[0]!, { texto: 'Certo.', locutor: 't', inicioMs: 700, fimMs: 900 }]
    expect(selecionarTurnosPaciente(uma, papeis, 1000, selecionarFalasPaciente(uma, papeis, 1000))).toEqual([])
  })
  const falaCom = (texto: string, locutor: string, inicioMs: number, fimMs: number) => ({ texto, locutor, inicioMs, fimMs })

  it('uma palavra ainda instável (fim igual ao limite) interrompe a leitura sem concluir o turno', () => {
    const palavras = [falaCom('Não durmo.', 'p', 0, 500), falaCom('Acordo cedo.', 'p', 600, 1000), falaCom('Entendo.', 't', 1100, 1200)]
    const falas = selecionarFalasPaciente(palavras, papeis, 1100)
    expect(selecionarTurnosPaciente(palavras, papeis, 1200, falas)).toEqual([])
    expect(selecionarTurnosPaciente(palavras, papeis, 1201, falas)).toHaveLength(1)
    expect(selecionarTurnosPaciente(palavras, papeis, 1100, falas)).toEqual([])
  })

  it('depois de fechar um turno, uma fala de uma frase só não vira turno', () => {
    const palavras = [
      falaCom('Não durmo.', 'p', 0, 500), falaCom('Acordo cedo.', 'p', 600, 1000), falaCom('Entendo.', 't', 1100, 1200),
      falaCom('Estou cansada.', 'p', 1300, 1600), falaCom('Certo.', 't', 1700, 1800),
    ]
    const falas = selecionarFalasPaciente(palavras, papeis, 9000)
    expect(selecionarTurnosPaciente(palavras, papeis, 9000, falas).map((turno) => turno.ancoras)).toEqual([['0:p', '600:p']])
  })

  it('o turno de até 2000 caracteres vale e o de 2001 não', () => {
    const falasDe = (tamanhoA: number, tamanhoB: number) => [
      { id: '0:p', frase: 'a'.repeat(tamanhoA), contexto: [] },
      { id: '600:p', frase: 'b'.repeat(tamanhoB), contexto: [] },
    ]
    const palavras = [falaCom('a', 'p', 0, 500), falaCom('b', 'p', 600, 1000), falaCom('Entendo.', 't', 1100, 1200)]
    expect(selecionarTurnosPaciente(palavras, papeis, 9000, falasDe(1000, 999))).toHaveLength(1)
    expect(selecionarTurnosPaciente(palavras, papeis, 9000, falasDe(1000, 1000))).toEqual([])
  })
})
