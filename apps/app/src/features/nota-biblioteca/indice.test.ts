import { describe, expect, it } from 'vitest'
import type { Nota } from '../../entities/nota/nota'
import { buscar, carregarIndice, construirIndice, impressaoDigital, notaParaDoc, serializarIndice } from './indice'

describe('buscar', () => {
  it('devolve a-preparar quando o índice ainda não existe (null)', () => {
    expect(buscar(null, 'febre')).toEqual({ estado: 'a-preparar' })
  })

  it('devolve ocioso quando o termo está vazio, mesmo com índice pronto', () => {
    const indice = construirIndice([{ id: '1', patientId: 'p1', texto: 'febre alta' }])

    expect(buscar(indice, '')).toEqual({ estado: 'ocioso' })
  })

  it('devolve pronto com ids vazios quando não acha nada -- nunca confundir com ocioso', () => {
    const indice = construirIndice([{ id: '1', patientId: 'p1', texto: 'febre alta' }])

    expect(buscar(indice, 'zzz')).toEqual({ estado: 'pronto', ids: [] })
  })
})

describe('notaParaDoc', () => {
  it('junta o texto de todas as frases, na ordem de nota.frases, num único campo', () => {
    const nota: Nota = {
      id: 'nota-1',
      patientId: 'p1',
      revisao: 0,
      frases: [
        { id: 'S-0', secao: 'S', texto: 'febre há 3 dias', ancoras: [] },
        { id: 'O-0', secao: 'O', texto: '38.5 graus', ancoras: [] },
      ],
      estado: 'pendente',
    }

    expect(notaParaDoc(nota)).toEqual({ id: 'nota-1', patientId: 'p1', texto: 'febre há 3 dias 38.5 graus' })
  })
})

describe('impressaoDigital', () => {
  function notaComRevisao(id: string, revisao: number): Nota {
    return { id, patientId: 'p1', revisao, frases: [], estado: 'pendente' }
  }

  it('é a mesma independentemente da ordem das notas', () => {
    const a = impressaoDigital([notaComRevisao('1', 0), notaComRevisao('2', 3)])
    const b = impressaoDigital([notaComRevisao('2', 3), notaComRevisao('1', 0)])

    expect(a).toBe(b)
  })

  it('muda quando a revisão de uma nota muda', () => {
    const antes = impressaoDigital([notaComRevisao('1', 0), notaComRevisao('2', 0)])
    const depois = impressaoDigital([notaComRevisao('1', 1), notaComRevisao('2', 0)])

    expect(depois).not.toBe(antes)
  })
})

describe('roundtrip construir -> serializar -> carregar -> buscar', () => {
  it('devolve os mesmos ids depois de serializar e recarregar o índice', () => {
    const docs = [
      { id: '1', patientId: 'p1', texto: 'febre alta e tosse' },
      { id: '2', patientId: 'p2', texto: 'dor de cabeça' },
    ]
    const indiceOriginal = construirIndice(docs)
    const antes = buscar(indiceOriginal, 'febre')

    const bytes = serializarIndice(indiceOriginal, 'impressao-1')
    // Prova que o roundtrip passa mesmo por uma fronteira serializada de verdade (não só
    // reusando o objeto MiniSearch em memória) -- é o que `persistirIndice`/`restaurarIndice`
    // (fatia 3) vão de facto atravessar via OPFS.
    const indiceRecarregado = carregarIndice(bytes, 'impressao-1')
    const depois = buscar(indiceRecarregado, 'febre')

    expect(depois).toEqual(antes)
    expect(depois).toEqual({ estado: 'pronto', ids: ['1'] })
  })

  it('carregarIndice devolve null quando a impressão não bate com a do envelope', () => {
    const indiceOriginal = construirIndice([{ id: '1', patientId: 'p1', texto: 'febre' }])
    const bytes = serializarIndice(indiceOriginal, 'impressao-1')

    expect(carregarIndice(bytes, 'impressao-2')).toBeNull()
  })
})
