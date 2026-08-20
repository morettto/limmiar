import { describe, expect, it } from 'vitest'
import { classificarLocutores, type LocutorCandidato } from './classify'

describe('classificarLocutores', () => {
  it('caso 1: dois candidatos bem separados, cadastrado igual a um deles → esse fica voce, outro paciente', () => {
    const cadastrado = [1, 0, 0]
    const candidatos: LocutorCandidato[] = [
      { locutor: 'SPEAKER_00', embedding: [1, 0, 0] },
      { locutor: 'SPEAKER_01', embedding: [0, 1, 0] },
    ]

    const resultado = classificarLocutores(cadastrado, candidatos)

    expect(resultado.get('SPEAKER_00')).toBe('voce')
    expect(resultado.get('SPEAKER_01')).toBe('paciente')
  })

  it('caso 2: diferença abaixo da margem mínima dá null para todos', () => {
    const cadastrado = [1, 0]
    const candidatos: LocutorCandidato[] = [
      { locutor: 'A', embedding: [1, 0] },
      { locutor: 'B', embedding: [0.999, 0.001] },
    ]

    const resultado = classificarLocutores(cadastrado, candidatos, 0.5)

    expect(resultado.get('A')).toBeNull()
    expect(resultado.get('B')).toBeNull()
  })

  it('caso 3: margemMinima customizada decide o corte entre ambíguo e decidido', () => {
    const cadastrado = [1, 0]
    const candidatos: LocutorCandidato[] = [
      { locutor: 'A', embedding: [1, 0] },
      { locutor: 'B', embedding: [0.9, 0.1] },
    ]

    const comMargemAlta = classificarLocutores(cadastrado, candidatos, 0.5)
    const comMargemBaixa = classificarLocutores(cadastrado, candidatos, 0.001)

    expect(comMargemAlta.get('A')).toBeNull()
    expect(comMargemBaixa.get('A')).toBe('voce')
    expect(comMargemBaixa.get('B')).toBe('paciente')
  })

  it('caso 4: um único candidato não tem rival — sempre voce', () => {
    const cadastrado = [1, 0]
    const candidatos: LocutorCandidato[] = [{ locutor: 'A', embedding: [0, 1] }]

    const resultado = classificarLocutores(cadastrado, candidatos)

    expect(resultado.get('A')).toBe('voce')
  })

  it('caso 5: nenhum candidato devolve mapa vazio', () => {
    const resultado = classificarLocutores([1, 0], [])

    expect(resultado.size).toBe(0)
  })

  it('caso 7: diferença exatamente igual à margemMinima decide (fronteira é < , não <=)', () => {
    const cadastrado = [1, 0]
    const candidatos: LocutorCandidato[] = [
      { locutor: 'A', embedding: [1, 0] }, // score 1
      { locutor: 'B', embedding: [0, 1] }, // score 0
    ]

    const resultado = classificarLocutores(cadastrado, candidatos, 1)

    expect(resultado.get('A')).toBe('voce')
    expect(resultado.get('B')).toBe('paciente')
  })

  it('caso 8: embedding com norma zero dá score NaN — trata como ambíguo, não "paciente" por omissão', () => {
    const cadastrado = [1, 0]
    const candidatos: LocutorCandidato[] = [
      { locutor: 'A', embedding: [1, 0] },
      { locutor: 'B', embedding: [0, 0] }, // vetor nulo → cosseno = 0/0 = NaN
    ]

    const resultado = classificarLocutores(cadastrado, candidatos)

    expect(resultado.get('A')).toBeNull()
    expect(resultado.get('B')).toBeNull()
  })

  it('caso 6: mais de dois candidatos, vencedor único fica voce e os restantes paciente', () => {
    const cadastrado = [1, 0, 0]
    const candidatos: LocutorCandidato[] = [
      { locutor: 'A', embedding: [0, 1, 0] },
      { locutor: 'B', embedding: [1, 0, 0] },
      { locutor: 'C', embedding: [0, 0, 1] },
    ]

    const resultado = classificarLocutores(cadastrado, candidatos)

    expect(resultado.get('B')).toBe('voce')
    expect(resultado.get('A')).toBe('paciente')
    expect(resultado.get('C')).toBe('paciente')
  })
})
