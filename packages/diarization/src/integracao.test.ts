import { describe, expect, it } from 'vitest'
import { atribuirLocutores, type PalavraAsr, type TurnoLocutor } from './merge'
import { classificarLocutores, type LocutorCandidato } from './classify'
import { montarTranscricaoCanonica } from './canonico'

describe('critério de aceite S06-02: teleconsulta com faixas separadas atinge 100% de acerto de atribuição', () => {
  it('atribuirLocutores + classificarLocutores rotulam corretamente voce/paciente numa teleconsulta com duas faixas distintas', () => {
    // Duas faixas de áudio separadas (profissional e paciente), diarizador
    // produz turnos bem distintos sem sobreposição — o cenário real de
    // teleconsulta com faixas separadas por participante.
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

    // Embeddings sintéticos bem separados (ortogonais) para o profissional
    // cadastrado e para os dois candidatos vindos do diarizador.
    const embeddingProfissional = [1, 0, 0]
    const candidatos: LocutorCandidato[] = [
      { locutor: 'SPEAKER_00', embedding: [1, 0, 0] },
      { locutor: 'SPEAKER_01', embedding: [0, 1, 0] },
    ]

    const palavrasAtribuidas = atribuirLocutores(palavrasAsr, turnos)
    // Passo 1: 100% das palavras recebem um locutor não-nulo (cada uma cai
    // inteiramente dentro de um único turno).
    expect(palavrasAtribuidas.every((p) => p.locutor !== null)).toBe(true)

    const rotulos = classificarLocutores(embeddingProfissional, candidatos)
    expect(rotulos.get('SPEAKER_00')).toBe('voce')
    expect(rotulos.get('SPEAKER_01')).toBe('paciente')

    const trechos = montarTranscricaoCanonica(palavrasAtribuidas, rotulos)

    expect(trechos).toEqual([
      { locutor: 'voce', palavras: palavrasAtribuidas.slice(0, 3) },
      { locutor: 'paciente', palavras: palavrasAtribuidas.slice(3, 5) },
      { locutor: 'voce', palavras: palavrasAtribuidas.slice(5, 8) },
    ])

    // 100% de acerto de atribuição: toda palavra falada pelo profissional
    // (SPEAKER_00) está rotulada 'voce', toda palavra do paciente está
    // rotulada 'paciente' — nenhuma palavra fica indeterminada ou trocada.
    const acertos = palavrasAtribuidas.filter((p) => {
      const rotuloEsperado = p.locutor === 'SPEAKER_00' ? 'voce' : 'paciente'
      return rotulos.get(p.locutor!) === rotuloEsperado
    })
    expect(acertos.length).toBe(palavrasAtribuidas.length)
  })
})
