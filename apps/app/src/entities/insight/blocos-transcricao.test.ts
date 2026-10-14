import { describe, expect, it } from 'vitest'
import type { RotuloLocutor } from '@limmiar/diarization'
import { formatarInstante, montarBlocos as agrupar } from './blocos-transcricao'
import type { LinhaTranscricao } from './linhas-transcricao'

const montarBlocos = (linhas: LinhaTranscricao[]) => agrupar(linhas, linhas.map(({ texto, inicioMs, fimMs, locutor }) => ({ texto, inicioMs, fimMs, locutor })))

let proxima = 0
const linha = (texto: string, locutor: string | null, papel: RotuloLocutor | null, inicioMs = proxima * 1000): LinhaTranscricao =>
  ({ id: `${proxima++}:${locutor}`, texto, inicioMs, fimMs: inicioMs + 500, papel, locutor, consultaId: null, parcial: false })
const resumo = (linhas: LinhaTranscricao[]) => montarBlocos(linhas).map((bloco) => [bloco.papel, bloco.pessoa, bloco.linhas.map((l) => l.texto).join(' ')])

describe('blocos da transcrição', () => {
  it('não conta silêncio nem mistura intervalos de pessoas que falam ao mesmo tempo', () => {
    const falas = [linha('Profissional', 'p', 'voce', 0), linha('Paciente', 's', 'paciente', 500)]
    falas[0]!.fimMs = 1000; falas[1]!.fimMs = 1500
    expect(agrupar(falas, [
      { texto: 'Profissional', locutor: 'p', inicioMs: 0, fimMs: 1000 },
      { texto: 'Paciente', locutor: 's', inicioMs: 500, fimMs: 1500 },
    ]).map(bloco => bloco.falaMs)).toEqual([1000, 1000])
    const continua = linha('Continuação', 'p', 'voce', 85000)
    continua.fimMs = 94000
    expect(agrupar([falas[0]!, continua], [
      { texto: 'Primeira', locutor: 'p', inicioMs: 0, fimMs: 1000 },
      { texto: 'Continuação', locutor: 'p', inicioMs: 85000, fimMs: 94000 },
    ])[0]).toMatchObject({ inicioMs: 0, falaMs: 10000 })
  })

  it('conta sobreposição uma vez mesmo se as palavras chegam fora de ordem', () => {
    const fala = { ...linha('Frase', 'p', 'voce', 0), fimMs: 1500 }
    expect(agrupar([fala], [
      { texto: 'Fim', locutor: 'p', inicioMs: 500, fimMs: 1500 },
      { texto: 'Início', locutor: 'p', inicioMs: 0, fimMs: 1000 },
    ])[0]!.falaMs).toBe(1500)
  })
  it('junta as falas seguidas do mesmo falante e só quebra quando outra pessoa fala', () => {
    proxima = 0
    const blocos = montarBlocos([linha('Bom dia.', 'p', 'voce'), linha('Como vai?', 'p', 'voce'), linha('Tenho medo.', 's', 'paciente'),
      linha('Dói muito.', 's', 'paciente'), linha('Entendo.', 'p', 'voce')])
    expect(blocos.map((bloco) => [bloco.papel, bloco.linhas.map((l) => l.texto)])).toEqual([
      ['voce', ['Bom dia.', 'Como vai?']], ['paciente', ['Tenho medo.', 'Dói muito.']], ['voce', ['Entendo.']],
    ])
    expect(blocos[1]).toMatchObject({ id: '2:s', inicioMs: 2000, pessoa: null })
  })

  it('duas vozes do servidor que são o profissional ficam num bloco só', () => {
    proxima = 0
    expect(resumo([linha('Uma.', 'a', 'voce'), linha('Duas.', 'b', 'voce'), linha('Três.', 'a', 'voce')])).toEqual([['voce', null, 'Uma. Duas. Três.']])
  })

  it('preserva vozes desconhecidas sem adivinhar profissional ou paciente', () => {
    proxima = 0
    expect(resumo([linha('Oi.', 'p', 'voce'), linha('Incerta.', 'x', null), linha('Sem falante.', null, null),
      linha('Outra.', 'y', null), linha('Voltei.', 'x', null)])).toEqual([
      ['voce', null, 'Oi.'], [null, null, 'Incerta.'], [null, null, 'Sem falante.'],
      [null, null, 'Outra.'], [null, null, 'Voltei.'],
    ])
  })

  it('mantém paciente confirmado mesmo com pessoas adicionais', () => {
    proxima = 0
    expect(resumo([linha('Paciente.', 'paciente', 'paciente'), linha('Outra pessoa.', 'pessoa_4', null),
      linha('Profissional.', 'profissional', 'voce'), linha('Paciente novamente.', 'paciente', 'paciente')])).toEqual([
      ['paciente', null, 'Paciente.'], [null, 4, 'Outra pessoa.'], ['voce', null, 'Profissional.'],
      ['paciente', null, 'Paciente novamente.'],
    ])
  })

  it('numera somente identidades canônicas sem papel confirmado', () => {
    proxima = 0
    expect(resumo([linha('A.', 'pessoa_2', null), linha('B.', 'pessoa_2', null), linha('C.', 'pessoa_3', null),
      linha('D.', 'pessoa_4_extra', null), linha('E.', 'pessoa_5', 'paciente')])).toEqual([
      [null, 2, 'A. B.'], [null, 3, 'C.'], [null, null, 'D.'], ['paciente', null, 'E.'],
    ])
  })

  it('fala sem identidade fica desconhecida no início e após pessoa confirmada', () => {
    proxima = 0
    expect(resumo([linha('Sem falante.', null, null), linha('Paciente.', 'paciente', 'paciente'),
      linha('Sem identificação.', null, null)])).toEqual([
      [null, null, 'Sem falante.'], ['paciente', null, 'Paciente.'], [null, null, 'Sem identificação.'],
    ])
  })

  it('sem linhas não há blocos', () => {
    expect(montarBlocos([])).toEqual([])
  })

  it.each([[0, '0:00'], [999, '0:00'], [12_300, '0:12'], [75_000, '1:15'], [3_725_000, '62:05']])('formata %d ms como %s', (ms, texto) => {
    expect(formatarInstante(ms)).toBe(texto)
  })
})
