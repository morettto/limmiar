import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { classificarLocutores, type LocutorCandidato } from './classify'

const MARGEM = 0.05

function cosseno(a: readonly number[], b: readonly number[]): number {
  let produto = 0
  let normaA = 0
  let normaB = 0
  for (let i = 0; i < a.length; i++) {
    produto += a[i]! * b[i]!
    normaA += a[i]! * a[i]!
    normaB += b[i]! * b[i]!
  }
  return produto / (Math.sqrt(normaA) * Math.sqrt(normaB))
}

// Vetor não-nulo de dimensão fixa — cosseno indefinido (0/0) num vetor nulo
// não é uma entrada real de embedding de locutor.
const arbVetor = fc
  .array(fc.integer({ min: -10, max: 10 }), { minLength: 3, maxLength: 3 })
  .filter((v) => v.some((x) => x !== 0))

const arbIdsDistintos = fc
  .array(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 2, maxLength: 4 })
  .filter((ids) => new Set(ids).size === ids.length)

describe('classificarLocutores — propriedades metamórficas', () => {
  it('M1: permutar a ordem dos candidatos não muda os rótulos (por id)', () => {
    fc.assert(
      fc.property(arbVetor, fc.array(arbVetor, { minLength: 2, maxLength: 5 }), (cadastrado, embeddings) => {
        const candidatos: LocutorCandidato[] = embeddings.map((embedding, i) => ({
          locutor: `S${i}`,
          embedding,
        }))
        const embaralhado = [...candidatos].reverse()

        const original = classificarLocutores(cadastrado, candidatos)
        const permutado = classificarLocutores(cadastrado, embaralhado)

        for (const c of candidatos) {
          expect(permutado.get(c.locutor)).toBe(original.get(c.locutor))
        }
      }),
    )
  })

  it('M2: renomear os ids opacos — os rótulos seguem o id, não a posição', () => {
    fc.assert(
      fc.property(arbVetor, fc.array(arbVetor, { minLength: 2, maxLength: 5 }), arbIdsDistintos, (cadastrado, embeddings, idsBrutos) => {
        fc.pre(idsBrutos.length >= embeddings.length)
        const ids = idsBrutos.slice(0, embeddings.length)
        const candidatosOriginais: LocutorCandidato[] = embeddings.map((embedding, i) => ({
          locutor: `orig_${i}`,
          embedding,
        }))
        const candidatosRenomeados: LocutorCandidato[] = embeddings.map((embedding, i) => ({
          locutor: ids[i]!,
          embedding,
        }))

        const original = classificarLocutores(cadastrado, candidatosOriginais)
        const renomeado = classificarLocutores(cadastrado, candidatosRenomeados)

        embeddings.forEach((_embedding, i) => {
          expect(renomeado.get(ids[i]!)).toBe(original.get(`orig_${i}`))
        })
      }),
    )
  })

  it('M3: escalar todos os embeddings por k>0 não muda os rótulos', () => {
    fc.assert(
      fc.property(
        arbVetor,
        fc.array(arbVetor, { minLength: 2, maxLength: 5 }),
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        (cadastrado, embeddings, k) => {
          const candidatos: LocutorCandidato[] = embeddings.map((embedding, i) => ({
            locutor: `S${i}`,
            embedding,
          }))
          const escalados: LocutorCandidato[] = embeddings.map((embedding, i) => ({
            locutor: `S${i}`,
            embedding: embedding.map((x) => x * k),
          }))

          const original = classificarLocutores(cadastrado, candidatos)
          const comEscala = classificarLocutores(cadastrado, escalados)

          for (const c of candidatos) {
            expect(comEscala.get(c.locutor)).toBe(original.get(c.locutor))
          }
        },
      ),
    )
  })

  it('M4: cadastrar o outro locutor (dos dois) inverte todos os rótulos', () => {
    fc.assert(
      fc.property(arbVetor, arbVetor, (embA, embB) => {
        const simCruzada = cosseno(embA, embB)
        // só é possível inverter de forma inequívoca quando a auto-similaridade
        // (1) supera a do rival pela margem nos dois sentidos.
        fc.pre(1 - simCruzada >= MARGEM)

        const candidatos: LocutorCandidato[] = [
          { locutor: 'A', embedding: embA },
          { locutor: 'B', embedding: embB },
        ]

        const cadastroA = classificarLocutores(embA, candidatos)
        const cadastroB = classificarLocutores(embB, candidatos)

        expect(cadastroA.get('A')).toBe('voce')
        expect(cadastroA.get('B')).toBe('paciente')
        expect(cadastroB.get('A')).toBe('paciente')
        expect(cadastroB.get('B')).toBe('voce')
      }),
    )
  })

  it('M5: dois candidatos com embedding igual ficam ambos null', () => {
    fc.assert(
      fc.property(arbVetor, arbVetor, (cadastrado, embeddingComum) => {
        const candidatos: LocutorCandidato[] = [
          { locutor: 'A', embedding: embeddingComum },
          { locutor: 'B', embedding: embeddingComum },
        ]

        const resultado = classificarLocutores(cadastrado, candidatos)

        expect(resultado.get('A')).toBeNull()
        expect(resultado.get('B')).toBeNull()
      }),
    )
  })

  it('M6: ruído abaixo da margem não muda os rótulos face ao caso sem ruído', () => {
    fc.assert(
      fc.property(arbVetor, arbVetor, arbVetor, (cadastrado, embA, embB) => {
        const simA = cosseno(cadastrado, embA)
        const simB = cosseno(cadastrado, embB)
        // o que decide null-vs-rotulado é a distância de |simA - simB| até
        // MARGEM: longe o bastante dessa fronteira (para os dois lados) para
        // que um ruído de 1e-6 não a atravesse.
        fc.pre(Math.abs(Math.abs(simA - simB) - MARGEM) >= 0.01)

        const candidatos: LocutorCandidato[] = [
          { locutor: 'A', embedding: embA },
          { locutor: 'B', embedding: embB },
        ]
        const ruido = 1e-6
        const comRuido: LocutorCandidato[] = [
          { locutor: 'A', embedding: embA.map((x) => x + ruido) },
          { locutor: 'B', embedding: embB.map((x) => x + ruido) },
        ]

        const semRuido = classificarLocutores(cadastrado, candidatos)
        const comRuidoResultado = classificarLocutores(cadastrado, comRuido)

        expect(comRuidoResultado.get('A')).toBe(semRuido.get('A'))
        expect(comRuidoResultado.get('B')).toBe(semRuido.get('B'))
      }),
    )
  })
})
