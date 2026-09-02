import type { Afirmacao } from '@limmiar/copilot'
import { describe, expect, it } from 'vitest'
import { digestNota, editarFrase, rascunhoParaNota, textoCanonico, type SecaoSoap } from './nota'

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const PATIENT_ID = '11111111-1111-1111-1111-111111111111'

function afirmacao(texto: string, ancoras: Afirmacao['ancoras'] = [{ inicioMs: 0, fimMs: 1000 }]): Afirmacao {
  return { texto, ancoras }
}

function porSecaoVazio(): Record<SecaoSoap, readonly Afirmacao[]> {
  return { S: [], O: [], A: [], P: [] }
}

describe('rascunhoParaNota', () => {
  it('ordena as frases por S, O, A, P e, dentro de cada secção, pela ordem do array de entrada, com revisao 0', () => {
    const porSecao = {
      ...porSecaoVazio(),
      S: [afirmacao('queixa 1'), afirmacao('queixa 2')],
      A: [afirmacao('hipótese 1')],
      P: [afirmacao('plano 1')],
    }

    const nota = rascunhoParaNota('nota-1', PATIENT_ID, porSecao)

    expect(nota.revisao).toBe(0)
    expect(nota.patientId).toBe(PATIENT_ID)
    expect(nota.frases.map((frase) => [frase.secao, frase.texto])).toEqual([
      ['S', 'queixa 1'],
      ['S', 'queixa 2'],
      ['A', 'hipótese 1'],
      ['P', 'plano 1'],
    ])
  })

  it('preserva as âncoras de cada afirmação sem as alterar', () => {
    const ancoras = [
      { inicioMs: 1000, fimMs: 2000 },
      { inicioMs: 3000, fimMs: 4000 },
    ]
    const porSecao = { ...porSecaoVazio(), S: [afirmacao('queixa', ancoras)] }

    const nota = rascunhoParaNota('nota-1', PATIENT_ID, porSecao)

    expect(nota.frases[0]?.ancoras).toEqual(ancoras)
  })

  it('gera ids estáveis e determinísticos (secção + índice), iguais em duas chamadas com a mesma entrada', () => {
    const porSecao = { ...porSecaoVazio(), S: [afirmacao('a'), afirmacao('b')], O: [afirmacao('c')] }

    const primeira = rascunhoParaNota('nota-1', PATIENT_ID, porSecao)
    const segunda = rascunhoParaNota('nota-1', PATIENT_ID, porSecao)

    expect(primeira.frases.map((frase) => frase.id)).toEqual(segunda.frases.map((frase) => frase.id))
    expect(primeira.frases.map((frase) => frase.id)).toEqual(['S-0', 'S-1', 'O-0'])
  })
})

describe('editarFrase', () => {
  it('devolve uma nota nova, com revisao incrementada e só o texto da frase alvo trocado, sem mutar a nota de entrada', () => {
    const porSecao = { ...porSecaoVazio(), S: [afirmacao('original 1'), afirmacao('original 2')] }
    const original = rascunhoParaNota('nota-1', PATIENT_ID, porSecao)
    const snapshot = structuredClone(original)

    const editada = editarFrase(original, 'S-0', 'texto novo')

    expect(editada).not.toBe(original)
    expect(editada.revisao).toBe(1)
    expect(editada.frases.map((frase) => frase.texto)).toEqual(['texto novo', 'original 2'])
    expect(original).toEqual(snapshot)
  })

  it('preserva as âncoras da frase editada intactas — editar o texto não pode perder a ligação ao áudio', () => {
    const ancoras = [{ inicioMs: 500, fimMs: 1500 }]
    const porSecao = { ...porSecaoVazio(), S: [afirmacao('original', ancoras)] }
    const original = rascunhoParaNota('nota-1', PATIENT_ID, porSecao)

    const editada = editarFrase(original, 'S-0', 'texto novo')

    expect(editada.frases[0]?.ancoras).toEqual(ancoras)
  })

  it('lança quando fraseId não existe na nota, em vez de devolver a nota inalterada em silêncio', () => {
    const original = rascunhoParaNota('nota-1', PATIENT_ID, { ...porSecaoVazio(), S: [afirmacao('a')] })

    expect(() => editarFrase(original, 'não-existe', 'x')).toThrow('nota-1')
  })
})

describe('textoCanonico', () => {
  it('é determinístico: a mesma nota produz sempre a mesma string', () => {
    const nota = rascunhoParaNota('nota-1', PATIENT_ID, { ...porSecaoVazio(), S: [afirmacao('queixa')] })

    expect(textoCanonico(nota)).toBe(textoCanonico(nota))
  })

  it('produz strings diferentes para notas com conteúdo diferente', () => {
    const notaA = rascunhoParaNota('nota-1', PATIENT_ID, { ...porSecaoVazio(), S: [afirmacao('queixa A')] })
    const notaB = rascunhoParaNota('nota-1', PATIENT_ID, { ...porSecaoVazio(), S: [afirmacao('queixa B')] })

    expect(textoCanonico(notaA)).not.toBe(textoCanonico(notaB))
  })

  it('muda quando só uma âncora troca — a assinatura tem de cobrir a citação, não só o texto', () => {
    const porSecao = {
      ...porSecaoVazio(),
      S: [afirmacao('queixa', [{ inicioMs: 1000, fimMs: 2000 }])],
    }
    const nota = rascunhoParaNota('nota-1', PATIENT_ID, porSecao)
    const notaComOutraAncora = rascunhoParaNota('nota-1', PATIENT_ID, {
      ...porSecaoVazio(),
      S: [afirmacao('queixa', [{ inicioMs: 5000, fimMs: 6000 }])],
    })

    expect(textoCanonico(nota)).not.toBe(textoCanonico(notaComOutraAncora))
  })
})

describe('digestNota', () => {
  it('produz o SHA-256 de textoCanonico — vetor conhecido colado neste teste', async () => {
    const porSecao = {
      ...porSecaoVazio(),
      S: [afirmacao('Paciente relata dor', [{ inicioMs: 1000, fimMs: 2000 }])],
    }
    const nota = rascunhoParaNota('nota-1', 'patient-1', porSecao)

    const resultado = await digestNota(nota)

    expect(bytesToHex(resultado)).toBe('b75bb3a41f6a7252028f851ea60f9d0b28c999991a15aa06717ba5cec477a12a')
  })
})
