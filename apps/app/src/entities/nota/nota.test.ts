import { describe, expect, it } from 'vitest'
import {
  digestNota,
  editarFrase,
  ESTADO_PENDENTE,
  ORDEM_SECOES,
  textoCanonico,
  type Nota,
  type SecaoSoap,
} from './nota'

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const PATIENT_ID = '11111111-1111-1111-1111-111111111111'

interface Afirmacao { texto: string; ancoras: { inicioMs: number; fimMs: number }[] }

function afirmacao(texto: string, ancoras: Afirmacao['ancoras'] = [{ inicioMs: 0, fimMs: 1000 }]): Afirmacao {
  return { texto, ancoras }
}

function porSecaoVazio(): Record<SecaoSoap, readonly Afirmacao[]> {
  return { S: [], O: [], A: [], P: [] }
}

function rascunhoParaNota(id: string, patientId: string, porSecao: Record<SecaoSoap, readonly Afirmacao[]>, atendimentoId = 'atendimento-1'): Nota {
  const frases = ORDEM_SECOES.flatMap((secao) => porSecao[secao].map((item, indice) => ({ id: `${secao}-${indice}`, secao, ...item })))
  return { id, patientId, atendimentoId, revisao: 0, frases, estado: ESTADO_PENDENTE }
}

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

  it('muda quando troca o atendimento — a assinatura atesta a sessão da nota', () => {
    const porSecao = { ...porSecaoVazio(), S: [afirmacao('queixa')] }

    expect(textoCanonico(rascunhoParaNota('nota-1', PATIENT_ID, porSecao, 'atendimento-1')))
      .not.toBe(textoCanonico(rascunhoParaNota('nota-1', PATIENT_ID, porSecao, 'atendimento-2')))
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

    expect(bytesToHex(resultado)).toBe('a709a2f1e4c78bc90b7ca3a8feb88ea32eb8a5f82691c79a797195051492c38a')
  })
})

