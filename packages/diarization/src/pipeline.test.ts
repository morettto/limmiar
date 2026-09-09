import { describe, expect, it } from 'vitest'
import { atribuirLocutores, type PalavraAsr, type TurnoLocutor } from './merge'
import { classificarLocutores, type LocutorCandidato } from './classify'
import { montarTranscricaoCanonica } from './canonico'
import { processarDiarizacao } from './pipeline'

describe('processarDiarizacao', () => {
  // Mesmos fixtures de src/integracao.test.ts (critério S06-02).
  const turnos: TurnoLocutor[] = [
    { locutor: 'SPEAKER_00', inicioMs: 0, fimMs: 2000 },
    { locutor: 'SPEAKER_01', inicioMs: 2000, fimMs: 4000 },
    { locutor: 'SPEAKER_00', inicioMs: 4000, fimMs: 6000 },
  ]

  const palavrasAsr: PalavraAsr[] = [
    { texto: 'olá,', inicioMs: 100, fimMs: 400 },
    { texto: 'como', inicioMs: 400, fimMs: 700 },
    { texto: 'está?', inicioMs: 700, fimMs: 1000 },
    { texto: 'bem,', inicioMs: 2100, fimMs: 2400 },
    { texto: 'obrigado.', inicioMs: 2400, fimMs: 2800 },
    { texto: 'ótimo,', inicioMs: 4100, fimMs: 4400 },
    { texto: 'vamos', inicioMs: 4400, fimMs: 4700 },
    { texto: 'começar.', inicioMs: 4700, fimMs: 5000 },
  ]

  const embeddingProfissional = [1, 0, 0]
  const candidatos: LocutorCandidato[] = [
    { locutor: 'SPEAKER_00', embedding: [1, 0, 0] },
    { locutor: 'SPEAKER_01', embedding: [0, 1, 0] },
  ]

  it('encadeia atribuirLocutores → classificarLocutores → montarTranscricaoCanonica de ponta a ponta', () => {
    const trechos = processarDiarizacao(palavrasAsr, turnos, embeddingProfissional, candidatos)

    const palavrasAtribuidas = atribuirLocutores(palavrasAsr, turnos)
    const rotulos = classificarLocutores(embeddingProfissional, candidatos)
    const trechosEsperados = montarTranscricaoCanonica(palavrasAtribuidas, rotulos)

    expect(trechos).toEqual(trechosEsperados)
    expect(trechos).toEqual([
      { locutor: 'voce', palavras: palavrasAtribuidas.slice(0, 3) },
      { locutor: 'paciente', palavras: palavrasAtribuidas.slice(3, 5) },
      { locutor: 'voce', palavras: palavrasAtribuidas.slice(5, 8) },
    ])
  })

  it('reencaminha margemMinima para classificarLocutores — deixa de decidir quando o argumento sobe acima da diferença de similaridade', () => {
    // Diferença de similaridade exata entre os dois candidatos: 0.1.
    // Default de classificarLocutores é 0.05 (0.1 >= 0.05 → decide).
    // margemMinima=0.2 explícito (0.1 >= 0.2 é falso → ambíguo → tudo null).
    const turnosMinimos: TurnoLocutor[] = [{ locutor: 'SPEAKER_00', inicioMs: 0, fimMs: 1000 }]
    const palavraMinima: PalavraAsr[] = [{ texto: 'oi', inicioMs: 0, fimMs: 500 }]
    const cadastradoMinimo = [1, 0]
    const candidatosMinimos: LocutorCandidato[] = [
      { locutor: 'SPEAKER_00', embedding: [1, 0] },
      { locutor: 'SPEAKER_01', embedding: [0.9, Math.sqrt(1 - 0.9 * 0.9)] },
    ]

    const semMargemExplicita = processarDiarizacao(
      palavraMinima,
      turnosMinimos,
      cadastradoMinimo,
      candidatosMinimos,
    )
    expect(semMargemExplicita).toEqual([
      { locutor: 'voce', palavras: atribuirLocutores(palavraMinima, turnosMinimos) },
    ])

    const comMargemMaior = processarDiarizacao(
      palavraMinima,
      turnosMinimos,
      cadastradoMinimo,
      candidatosMinimos,
      0.2,
    )
    expect(comMargemMaior).toEqual([])
  })
})
