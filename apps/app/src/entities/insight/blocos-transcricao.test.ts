import { describe, expect, it } from 'vitest'
import type { RotuloLocutor } from '@limmiar/diarization'
import { formatarInstante, montarBlocos } from './blocos-transcricao'
import type { LinhaTranscricao } from './linhas-transcricao'

let proxima = 0
const linha = (texto: string, locutor: string | null, papel: RotuloLocutor | null, inicioMs = proxima * 1000): LinhaTranscricao =>
  ({ id: `${proxima++}:${locutor}`, texto, inicioMs, fimMs: inicioMs + 500, papel, locutor, consultaId: null, parcial: false })
const resumo = (linhas: LinhaTranscricao[]) => montarBlocos(linhas).map((bloco) => [bloco.papel, bloco.pessoa, bloco.linhas.map((l) => l.texto).join(' ')])

describe('blocos da transcrição', () => {
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

  it('depois que um falante é confirmado como profissional, qualquer outra voz sem papel já é paciente', () => {
    proxima = 0
    expect(resumo([linha('Oi.', 'p', 'voce'), linha('Ainda sem voz.', 'x', null), linha('Sem falante', null, null), linha('Sou eu.', 'p', 'voce'),
      linha('Outra voz.', 'y', null)])).toEqual([
      ['voce', null, 'Oi.'], ['paciente', 2, 'Ainda sem voz. Sem falante'], ['voce', null, 'Sou eu.'], ['paciente', 3, 'Outra voz.'],
    ])
  })

  it('antes de qualquer confirmação a primeira voz é o profissional e a segunda já é paciente', () => {
    proxima = 0
    expect(resumo([linha('Bom dia.', 'x', null), linha('Sem falante', null, null), linha('Tenho medo.', 'y', null), linha('E mais.', null, null),
      linha('Doutora.', 'x', null)])).toEqual([
      ['voce', null, 'Bom dia. Sem falante'], ['paciente', null, 'Tenho medo. E mais.'], ['voce', null, 'Doutora.'],
    ])
  })

  it('a primeira voz sem papel é o profissional mesmo que outra já tenha sido decidida como paciente', () => {
    proxima = 0
    expect(resumo([linha('Bom dia.', 'x', 'paciente'), linha('Oi.', 'y', null), linha('Tchau.', 'z', null)])).toEqual([
      ['paciente', 2, 'Bom dia.'], ['voce', null, 'Oi.'], ['paciente', 3, 'Tchau.'],
    ])
  })

  it('o texto sem falante no começo é provisoriamente do profissional', () => {
    proxima = 0
    expect(resumo([linha('Sem falante', null, null)])).toEqual([['voce', null, 'Sem falante']])
    proxima = 0
    expect(resumo([linha('Bom dia.', 'x', 'paciente')])).toEqual([['paciente', null, 'Bom dia.']])
  })

  it('com mais de uma voz que não é o profissional numera Pessoa 2, Pessoa 3 pela ordem em que falam', () => {
    proxima = 0
    const blocos = montarBlocos([linha('Oi.', 'p', 'voce'), linha('Eu.', 'b', 'paciente'), linha('Eu também.', 'c', 'paciente'),
      linha('E eu.', 'b', 'paciente'), linha('Sim.', 'p', 'voce')])
    expect(blocos.map((bloco) => [bloco.papel, bloco.pessoa])).toEqual([['voce', null], ['paciente', 2], ['paciente', 3], ['paciente', 2], ['voce', null]])
  })

  it('sem linhas não há blocos', () => {
    expect(montarBlocos([])).toEqual([])
  })

  it.each([[0, '0:00'], [999, '0:00'], [12_300, '0:12'], [75_000, '1:15'], [3_725_000, '62:05']])('formata %d ms como %s', (ms, texto) => {
    expect(formatarInstante(ms)).toBe(texto)
  })
})
