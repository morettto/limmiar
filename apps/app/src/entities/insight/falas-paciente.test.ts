import { describe, expect, it } from 'vitest'
import { selecionarFalasPaciente } from './falas-paciente'

describe('falas do paciente para análise', () => {
  it('mantém frases concluídas enquanto a próxima cresce, sem julgar prefixos sem contexto completo', () => {
    const palavras = [
      { texto: 'Acordo', locutor: 'p', inicioMs: 0, fimMs: 200 },
      { texto: 'assustada.', locutor: 'p', inicioMs: 200, fimMs: 600 },
      { texto: 'Quando', locutor: 'p', inicioMs: 700, fimMs: 900 },
    ]
    const anterior = selecionarFalasPaciente(palavras, { p: 'paciente' }, 1000)
    expect(anterior).toEqual([{ id: '0:p', frase: 'Acordo assustada.', contexto: [] }])
    palavras.push({ texto: 'ouço', locutor: 'p', inicioMs: 900, fimMs: 1100 })
    expect(selecionarFalasPaciente(palavras, { p: 'paciente' }, 1200)).toEqual(anterior)
    palavras.push({ texto: 'barulho!', locutor: 'p', inicioMs: 1100, fimMs: 1400 })
    expect(selecionarFalasPaciente(palavras, { p: 'paciente' }, 1500)).toEqual([
      ...anterior, { id: '700:p', frase: 'Quando ouço barulho!', contexto: ['Acordo assustada.'] },
    ])
  })
  it('fecha fala sem pontuação numa pausa estável ou troca de locutor', () => {
    const palavras = [{ texto: 'Não durmo', locutor: 'p', inicioMs: 0, fimMs: 500 }]
    expect(selecionarFalasPaciente(palavras, { p: 'paciente' }, 1399)).toEqual([])
    const primeira = { id: '0:p', frase: 'Não durmo', contexto: [] }
    expect(selecionarFalasPaciente(palavras, { p: 'paciente' }, 1400)).toEqual([primeira])
    palavras.push({ texto: 'há dias?', locutor: 'p', inicioMs: 1500, fimMs: 1700 })
    expect(selecionarFalasPaciente(palavras, { p: 'paciente' }, 1800)).toEqual([
      primeira, { id: '1500:p', frase: 'há dias?', contexto: ['Não durmo'] },
    ])
    palavras[1] = { texto: 'Outra voz…', locutor: 'q', inicioMs: 500, fimMs: 700 }
    expect(selecionarFalasPaciente(palavras, { p: 'paciente', q: 'paciente' }, 800)).toEqual([
      primeira, { id: '500:q', frase: 'Outra voz…', contexto: ['Não durmo'] },
    ])
  })
  it('recalcula o contexto quando uma frase anterior é corrigida e reconhece pontuação antes de aspas', () => {
    const palavras = [
      { texto: 'Minha irmã disse: “Tenho medo.”', locutor: 'p', inicioMs: 0, fimMs: 500 },
      { texto: 'Eu não sinto isso.', locutor: 'p', inicioMs: 500, fimMs: 1000 },
    ]
    expect(selecionarFalasPaciente(palavras, { p: 'paciente' }, 1100)[1]!.contexto).toEqual([palavras[0]!.texto])
    palavras[0]!.texto = 'Meu irmão disse: “Tenho medo.”'
    expect(selecionarFalasPaciente(palavras, { p: 'paciente' }, 1100)[1]!.contexto).toEqual([palavras[0]!.texto])
  })
  it('preserva contexto do paciente, exclui profissional e desconhecidos e espera a estabilidade acústica', () => {
    const palavras = [
      { texto: 'Tenho medo.', locutor: 'speaker_2', inicioMs: 0, fimMs: 1000 },
      { texto: 'De quem?', locutor: 'speaker_1', inicioMs: 1100, fimMs: 2000 },
      { texto: 'De sair', locutor: 'speaker_2', inicioMs: 2100, fimMs: 2500 },
      { texto: 'de casa.', locutor: 'speaker_2', inicioMs: 2500, fimMs: 3000 },
      { texto: 'Desconhecido', locutor: null, inicioMs: 3100, fimMs: 4000 },
      { texto: 'Não é de morrer.', locutor: 'speaker_2', inicioMs: 4100, fimMs: 5000 },
    ]
    const papeis = { speaker_1: 'voce' as const, speaker_2: 'paciente' as const }
    expect(selecionarFalasPaciente(palavras, papeis, 5000)).toEqual([
      { id: '0:speaker_2', frase: 'Tenho medo.', contexto: [] },
      { id: '2100:speaker_2', frase: 'De sair de casa.', contexto: ['Tenho medo.'] },
    ])
    expect(selecionarFalasPaciente(palavras, { speaker_2: null }, Infinity)).toEqual([])
    expect(selecionarFalasPaciente(palavras, { speaker_2: 'voce' }, Infinity)).toEqual([])
  })
  it('divide contexto longo sem perder palavras e limita as cinco falas anteriores', () => {
    const palavras = Array.from({ length: 7 }, (_, i) => ({ texto: `${i} ${'x'.repeat(998)}`, locutor: 's', inicioMs: i * 1000, fimMs: (i + 1) * 1000 }))
    const falas = selecionarFalasPaciente(palavras, { s: 'paciente' }, Infinity)
    expect(falas).toHaveLength(7)
    expect(falas[6]!.contexto).toHaveLength(5)
    expect(falas[6]!.contexto[0]).toBe(palavras[1]!.texto)
    expect(falas.map((fala) => fala.frase)).toEqual(palavras.map((palavra) => palavra.texto))
    expect(selecionarFalasPaciente([{ texto: ' ', locutor: 's', inicioMs: 0, fimMs: 0 }], { s: 'paciente' }, 1)).toEqual([])
  })
})
