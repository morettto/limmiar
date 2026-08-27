import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { atribuirLocutores, type PalavraAsr, type TurnoLocutor } from './merge'

// Palavras ordenadas, não sobrepostas: cada palavra começa onde a anterior
// terminou (ou depois, via `gap`), nunca antes — reflete a saída real de um
// ASR, que emite palavras em ordem cronológica sem sobreposição.
const arbPalavras = fc
  .array(fc.record({ gap: fc.integer({ min: 0, max: 20 }), dur: fc.integer({ min: 0, max: 50 }) }), {
    maxLength: 20,
  })
  .map((itens) => {
    let cursor = 0
    const palavras: PalavraAsr[] = []
    for (const { gap, dur } of itens) {
      cursor += gap
      const inicioMs = cursor
      const fimMs = cursor + dur
      palavras.push({ texto: 'w', inicioMs, fimMs })
      cursor = fimMs
    }
    return palavras
  })

// Turnos arbitrários: ordem, sobreposição entre si, e mesmo `fimMs <= inicioMs`
// (inválido) são todos permitidos — o merge deve lidar com qualquer forma.
const arbTurnos = fc.array(
  fc.record({
    locutor: fc.string({ minLength: 1, maxLength: 5 }),
    inicioMs: fc.integer({ min: -50, max: 1000 }),
    fimMs: fc.integer({ min: -50, max: 1000 }),
  }),
  { maxLength: 15 },
)

const arbTurnosComPermutacao = arbTurnos.chain((turnos) =>
  fc.tuple(
    fc.constant(turnos),
    fc.shuffledSubarray(turnos, { minLength: turnos.length, maxLength: turnos.length }),
  ),
)

describe('atribuirLocutores — propriedades', () => {
  it('P1: totalidade — comprimento, ordem e campos preservados; locutor válido', () => {
    fc.assert(
      fc.property(arbPalavras, arbTurnos, (palavras, turnos) => {
        const resultado = atribuirLocutores(palavras, turnos)

        expect(resultado.length).toBe(palavras.length)
        resultado.forEach((item, i) => {
          expect(item.texto).toBe(palavras[i]!.texto)
          expect(item.inicioMs).toBe(palavras[i]!.inicioMs)
          expect(item.fimMs).toBe(palavras[i]!.fimMs)
          expect(item.locutor === null || typeof item.locutor === 'string').toBe(true)
          if (item.locutor !== null) {
            expect(item.locutor.length).toBeGreaterThan(0)
          }
        })
      }),
    )
  })

  it('P2: independência de ordem dos turnos', () => {
    fc.assert(
      fc.property(arbPalavras, arbTurnosComPermutacao, (palavras, [turnos, turnosEmbaralhados]) => {
        const original = atribuirLocutores(palavras, turnos)
        const embaralhado = atribuirLocutores(palavras, turnosEmbaralhados)
        expect(embaralhado).toEqual(original)
      }),
    )
  })

  it('P3: turno único cobrindo tudo — toda palavra recebe esse locutor, nenhuma null', () => {
    fc.assert(
      fc.property(arbPalavras, fc.string({ minLength: 1, maxLength: 5 }), (palavras, locutorId) => {
        const inicios = palavras.map((p) => p.inicioMs)
        const fins = palavras.map((p) => p.fimMs)
        const min = inicios.length > 0 ? Math.min(...inicios) : 0
        const max = fins.length > 0 ? Math.max(...fins) : 1
        const turno: TurnoLocutor = { locutor: locutorId, inicioMs: min - 1, fimMs: max + 1 }

        const resultado = atribuirLocutores(palavras, [turno])

        resultado.forEach((item) => {
          expect(item.locutor).toBe(locutorId)
        })
      }),
    )
  })
})
