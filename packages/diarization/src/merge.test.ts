import { describe, expect, it } from 'vitest'
import { atribuirLocutores, type PalavraAsr, type TurnoLocutor } from './merge'

describe('atribuirLocutores', () => {
  it('caso 1: palavra inteira dentro de um turno recebe esse locutor', () => {
    const palavras: PalavraAsr[] = [{ texto: 'oi', inicioMs: 100, fimMs: 200 }]
    const turnos: TurnoLocutor[] = [{ locutor: 'SPEAKER_00', inicioMs: 0, fimMs: 1000 }]

    const resultado = atribuirLocutores(palavras, turnos)

    expect(resultado).toEqual([{ texto: 'oi', inicioMs: 100, fimMs: 200, locutor: 'SPEAKER_00' }])
  })

  it('caso 8: turnos vazios devolve todas as palavras com locutor null', () => {
    const palavras: PalavraAsr[] = [{ texto: 'oi', inicioMs: 100, fimMs: 200 }]

    const resultado = atribuirLocutores(palavras, [])

    expect(resultado).toEqual([{ texto: 'oi', inicioMs: 100, fimMs: 200, locutor: null }])
  })

  it('caso 9: palavras vazias devolve array vazio', () => {
    const turnos: TurnoLocutor[] = [{ locutor: 'SPEAKER_00', inicioMs: 0, fimMs: 1000 }]

    const resultado = atribuirLocutores([], turnos)

    expect(resultado).toEqual([])
  })

  it('caso 2: palavra atravessa fronteira 70/30, fica com o lado maior', () => {
    // palavra [0,100): 70ms em A [0,70), 30ms em B [70,200)
    const palavras: PalavraAsr[] = [{ texto: 'x', inicioMs: 0, fimMs: 100 }]
    const turnos: TurnoLocutor[] = [
      { locutor: 'A', inicioMs: 0, fimMs: 70 },
      { locutor: 'B', inicioMs: 70, fimMs: 200 },
    ]

    const resultado = atribuirLocutores(palavras, turnos)

    expect(resultado[0]?.locutor).toBe('A')
  })

  it('caso 3: palavra atravessa fronteira 50/50 entre locutores distintos dá null', () => {
    const palavras: PalavraAsr[] = [{ texto: 'x', inicioMs: 0, fimMs: 100 }]
    const turnos: TurnoLocutor[] = [
      { locutor: 'A', inicioMs: 0, fimMs: 50 },
      { locutor: 'B', inicioMs: 50, fimMs: 200 },
    ]

    const resultado = atribuirLocutores(palavras, turnos)

    expect(resultado[0]?.locutor).toBeNull()
  })

  it('caso 4: palavra atravessa fronteira 50/50 mas o mesmo locutor está nos dois turnos', () => {
    const palavras: PalavraAsr[] = [{ texto: 'x', inicioMs: 0, fimMs: 100 }]
    const turnos: TurnoLocutor[] = [
      { locutor: 'A', inicioMs: 0, fimMs: 50 },
      { locutor: 'A', inicioMs: 50, fimMs: 200 },
    ]

    const resultado = atribuirLocutores(palavras, turnos)

    expect(resultado[0]?.locutor).toBe('A')
  })

  it('caso 11: palavra de duração zero exatamente na fronteira [a,b)/[b,c) pertence a [b,c)', () => {
    const palavras: PalavraAsr[] = [{ texto: 'x', inicioMs: 50, fimMs: 50 }]
    const turnos: TurnoLocutor[] = [
      { locutor: 'A', inicioMs: 0, fimMs: 50 },
      { locutor: 'B', inicioMs: 50, fimMs: 100 },
    ]

    const resultado = atribuirLocutores(palavras, turnos)

    expect(resultado[0]?.locutor).toBe('B')
  })

  it('caso 5: turnos sobrepostos com sobreposições distintas, vence a maior', () => {
    // palavra [0,100). A [0,80) → 80ms de overlap. B [60,100) → 40ms de overlap.
    const palavras: PalavraAsr[] = [{ texto: 'x', inicioMs: 0, fimMs: 100 }]
    const turnos: TurnoLocutor[] = [
      { locutor: 'A', inicioMs: 0, fimMs: 80 },
      { locutor: 'B', inicioMs: 60, fimMs: 100 },
    ]

    const resultado = atribuirLocutores(palavras, turnos)

    expect(resultado[0]?.locutor).toBe('A')
  })

  it('caso 6: turnos sobrepostos com sobreposições idênticas dá null', () => {
    // palavra [0,100). A [0,50) → 50ms. B [50,100) e mais A/B simétricos com mesma soma.
    const palavras: PalavraAsr[] = [{ texto: 'x', inicioMs: 0, fimMs: 100 }]
    const turnos: TurnoLocutor[] = [
      { locutor: 'A', inicioMs: 0, fimMs: 50 },
      { locutor: 'B', inicioMs: 50, fimMs: 100 },
    ]

    const resultado = atribuirLocutores(palavras, turnos)

    expect(resultado[0]?.locutor).toBeNull()
  })

  it('caso 12: dois turnos de A somam mais do que um turno de B, mesmo cada um isolado sendo menor', () => {
    // palavra [0,1000). A1 [0,300) = 300ms, A2 [700,1000) = 300ms → soma A = 600ms.
    // B [300,700) = 400ms. Cada bloco de A (300ms) < bloco de B (400ms), mas soma de A vence.
    const palavras: PalavraAsr[] = [{ texto: 'x', inicioMs: 0, fimMs: 1000 }]
    const turnos: TurnoLocutor[] = [
      { locutor: 'A', inicioMs: 0, fimMs: 300 },
      { locutor: 'B', inicioMs: 300, fimMs: 700 },
      { locutor: 'A', inicioMs: 700, fimMs: 1000 },
    ]

    const resultado = atribuirLocutores(palavras, turnos)

    expect(resultado[0]?.locutor).toBe('A')
  })

  it('caso 7: palavra em silêncio, nenhum turno toca, dá null', () => {
    const palavras: PalavraAsr[] = [{ texto: 'x', inicioMs: 500, fimMs: 600 }]
    const turnos: TurnoLocutor[] = [
      { locutor: 'A', inicioMs: 0, fimMs: 100 },
      { locutor: 'B', inicioMs: 1000, fimMs: 1100 },
    ]

    const resultado = atribuirLocutores(palavras, turnos)

    expect(resultado[0]?.locutor).toBeNull()
  })

  it('caso 10: palavra de duração zero dentro de um turno recebe esse locutor', () => {
    const palavras: PalavraAsr[] = [{ texto: 'x', inicioMs: 50, fimMs: 50 }]
    const turnos: TurnoLocutor[] = [{ locutor: 'A', inicioMs: 0, fimMs: 100 }]

    const resultado = atribuirLocutores(palavras, turnos)

    expect(resultado[0]?.locutor).toBe('A')
  })

  it('caso 13: turno com fimMs < inicioMs é ignorado (sobreposição zero por construção)', () => {
    const palavras: PalavraAsr[] = [{ texto: 'x', inicioMs: 0, fimMs: 100 }]
    const turnos: TurnoLocutor[] = [
      { locutor: 'invalido', inicioMs: 100, fimMs: 50 },
      { locutor: 'A', inicioMs: 0, fimMs: 100 },
    ]

    const resultado = atribuirLocutores(palavras, turnos)

    expect(resultado[0]?.locutor).toBe('A')
  })

  // Casos extra (fora da tabela de mesa) exigidos pelo portão de mutação:
  // cobrem os dois limites da fórmula de `sobreposicao` que a tabela não
  // isola sozinha.

  it('palavra degenerada antes do início do turno não conta como sobreposição', () => {
    // Cobre o limite inferior `t.inicioMs <= p.inicioMs` isoladamente do
    // superior: sem ele, `p.inicioMs < t.fimMs` (10 < 100) bastaria para
    // marcar sobreposição indevida.
    const palavras: PalavraAsr[] = [{ texto: 'x', inicioMs: 10, fimMs: 10 }]
    const turnos: TurnoLocutor[] = [{ locutor: 'A', inicioMs: 50, fimMs: 100 }]

    const resultado = atribuirLocutores(palavras, turnos)

    expect(resultado[0]?.locutor).toBeNull()
  })

  it('palavra ASR invertida (fimMs < inicioMs) é tratada como ponto de 1ms em inicioMs', () => {
    // Entrada hipotética inválida do ASR. A fórmula não distingue este caso
    // do degenerado: `Math.max(p.fimMs, p.inicioMs + 1)` normaliza fimMs
    // para inicioMs + 1 sempre que fimMs não excede esse valor, tratando a
    // palavra como o ponto [inicioMs, inicioMs+1).
    const palavras: PalavraAsr[] = [{ texto: 'x', inicioMs: 50, fimMs: 10 }]
    const turnos: TurnoLocutor[] = [
      { locutor: 'A', inicioMs: 0, fimMs: 50 },
      { locutor: 'B', inicioMs: 50, fimMs: 100 },
    ]

    const resultado = atribuirLocutores(palavras, turnos)

    expect(resultado[0]?.locutor).toBe('B')
  })

  it('um único turno com sobreposição zero não vira vencedor por ausência de rival', () => {
    // Sem nenhum outro turno para "empatar" a zero, um peso zero isolado
    // tem de continuar a dar null — não pode vencer só por ser o único candidato.
    const palavras: PalavraAsr[] = [{ texto: 'x', inicioMs: 500, fimMs: 600 }]
    const turnos: TurnoLocutor[] = [{ locutor: 'A', inicioMs: 0, fimMs: 100 }]

    const resultado = atribuirLocutores(palavras, turnos)

    expect(resultado[0]?.locutor).toBeNull()
  })
})
