import { describe, expect, it } from 'vitest'
import { montarLinhasTranscricao } from './linhas-transcricao'
import type { PalavraAtribuida } from '@limmiar/diarization'

const palavra = (texto: string, inicioMs: number, locutor: string | null, duracao = 100): PalavraAtribuida => ({ texto, inicioMs, fimMs: inicioMs + duracao, locutor })
describe('linhas da transcrição', () => {
  it('preserva profissional, paciente, desconhecido e hipótese sem alterar o texto', () => {
    const palavras = [palavra('Como está?', 0, 'p'), palavra('Tenho', 200, 's'), palavra('medo.', 400, 's'),
      palavra('Quando', 600, 's'), palavra('chego', 800, 's'), palavra('Olá', 1000, null)]
    const linhas = montarLinhasTranscricao(palavras, { p: 'voce', s: 'paciente' }, [{ id: '200:s', frase: 'Tenho medo.', contexto: [] }])
    expect(linhas.map((linha) => [linha.texto, linha.papel, linha.consultaId])).toEqual([
      ['Como está?', 'voce', null], ['Tenho medo.', 'paciente', '200:s'], ['Quando chego', 'paciente', null], ['Olá', null, null],
    ])
    expect(linhas.map((linha) => linha.texto).join(' ')).toBe(palavras.map((p) => p.texto).join(' '))
    expect(linhas[1]).toMatchObject({ inicioMs: 200, fimMs: 500 })
  })
  it('não herda vínculo de consulta com texto ou papel anterior', () => {
    const consultas = [{ id: '0:s', frase: 'Tenho medo.', contexto: [] }]
    expect(montarLinhasTranscricao([palavra('Não', 0, 's'), palavra('tenho', 200, 's'), palavra('medo.', 400, 's')], { s: 'paciente' }, consultas)[0])
      .toMatchObject({ texto: 'Não tenho medo.', consultaId: null })
    expect(montarLinhasTranscricao([palavra('Tenho medo.', 0, 's')], { s: 'voce' }, consultas)[0]!.consultaId).toBeNull()
  })
  it('separa a próxima consulta, uma pausa, pontuação e papel não identificado', () => {
    const palavras = [palavra('Medo', 0, 's'), palavra('Tristeza', 200, 's'), palavra('Voltei…', 1300, 's'),
      palavra('Hoje', 1500, 's'), palavra('Outra', 1700, 'x')]
    const linhas = montarLinhasTranscricao(palavras, { s: 'paciente' }, [{ id: '200:s', frase: 'Tristeza', contexto: [] }])
    expect(linhas.map((l) => l.texto)).toEqual(['Medo', 'Tristeza', 'Voltei…', 'Hoje', 'Outra'])
    expect(linhas[4]!.papel).toBeNull()
    expect(montarLinhasTranscricao([], {}, [])).toEqual([])
  })
  it('guarda o falante de cada linha e não mistura palavras finais com hipótese', () => {
    const palavras = [palavra('Bom', 0, 's'), palavra('dia', 200, 's'), palavra('doutora', 400, 's'), palavra('tenho', 600, 's')]
    const linhas = montarLinhasTranscricao(palavras, {}, [], 3)
    expect(linhas.map((l) => [l.texto, l.locutor, l.parcial])).toEqual([['Bom dia doutora', 's', false], ['tenho', 's', true]])
    expect(montarLinhasTranscricao(palavras, {}, [])[0]).toMatchObject({ texto: 'Bom dia doutora tenho', parcial: false })
    const consulta = [{ id: '0:s', frase: 'Bom dia doutora tenho', contexto: [] }]
    expect(montarLinhasTranscricao(palavras, { s: 'paciente' }, consulta, 3)[0]).toMatchObject({ texto: 'Bom dia doutora', consultaId: null })
  })
  it('junta as palavras de hipótese entre si, sem misturar com as finais', () => {
    const palavras = [palavra('Bom', 0, 's'), palavra('dia', 200, 's'), palavra('tenho', 400, 's'), palavra('medo', 600, 's')]
    const linhas = montarLinhasTranscricao(palavras, {}, [], 2)
    expect(linhas.map((l) => [l.texto, l.parcial])).toEqual([['Bom dia', false], ['tenho medo', true]])
    expect(montarLinhasTranscricao(palavras, {}, [], 0).map((l) => [l.texto, l.parcial])).toEqual([['Bom dia tenho medo', true]])
  })

  it('só junta ao vínculo de consulta palavras do mesmo falante', () => {
    const consultas = [{ id: '0:s', frase: 'Tenho medo agora.', contexto: [] }]
    const linhas = montarLinhasTranscricao([palavra('Tenho', 0, 's'), palavra('medo', 200, 's'), palavra('agora.', 400, 'x')], { s: 'paciente', x: 'paciente' }, consultas)
    expect(linhas.map((l) => [l.texto, l.consultaId])).toEqual([['Tenho medo', null], ['agora.', null]])
  })

  it('uma pausa de exatamente 900 ms separa as linhas e uma de 899 ms não', () => {
    const exata = [palavra('Um', 0, 's'), palavra('dois', 1000, 's')]
    expect(montarLinhasTranscricao(exata, {}, []).map((l) => l.texto)).toEqual(['Um', 'dois'])
    const curta = [palavra('Um', 0, 's'), palavra('dois', 999, 's')]
    expect(montarLinhasTranscricao(curta, {}, []).map((l) => l.texto)).toEqual(['Um dois'])
  })

  it('só encerra a linha quando a pontuação final está no fim, com fechamento de aspas ou espaço sobrando', () => {
    expect(montarLinhasTranscricao([palavra('A.B', 0, 's'), palavra('continua', 200, 's')], {}, []).map((l) => l.texto)).toEqual(['A.B continua'])
    expect(montarLinhasTranscricao([palavra('disse."', 0, 's'), palavra('Depois', 200, 's')], {}, []).map((l) => l.texto)).toEqual(['disse."', 'Depois'])
    expect(montarLinhasTranscricao([palavra('fim. ', 0, 's'), palavra('Depois', 200, 's')], {}, []).map((l) => l.texto)).toEqual(['fim. ', 'Depois'])
    expect(montarLinhasTranscricao([palavra('será?)', 0, 's'), palavra('Depois', 200, 's')], {}, []).map((l) => l.texto)).toEqual(['será?)', 'Depois'])
  })

  it('cada linha leva o índice e o início da fala no identificador', () => {
    const linhas = montarLinhasTranscricao([palavra('Um.', 0, 's'), palavra('Dois.', 500, 's')], {}, [])
    expect(linhas.map((l) => l.id)).toEqual(['0:0:s', '1:500:s'])
  })
})
