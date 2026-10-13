import { describe, expect, it } from 'vitest'
import { webcrypto } from '@limmiar/crypto'
import { ESTADO_ASSINADA, ESTADO_PENDENTE, editarFrase, type Nota, type ReferenciaBibliografica } from './nota'
import { adicionarReferencia, lerReferencia, type PropostaReferencia } from './referencia'
import { notaParaEntrada, selarAssinatura, verificarAssinatura } from './nota-crypto'
import { lerNota } from './ler-nota'

const referencia: ReferenciaBibliografica = { trechoId: 'fonte', titulo: 'Livro', autor: 'Autor', pagina: 4, paragrafo: 2,
  citacaoLiteral: 'Citação literal revisada.', transcriptId: 'sessao', revisaoTranscricao: 1, frasePaciente: 'Tenho medo.' }
const proposta: PropostaReferencia = { patientId: 'paciente', inicioMs: 100, fimMs: 900, referencia }
const nota: Nota = { id: 'nota', patientId: 'paciente', atendimentoId: 'sessao', revisao: 0, estado: ESTADO_PENDENTE,
  frases: [{ id: 'S-0', secao: 'S', texto: 'Texto escrito pelo profissional', ancoras: [] }] }

describe('referência aprovada', () => {
  it('preserva o texto profissional, inclui avaliação com âncora e reabre sem duplicar a fonte', () => {
    const nova = adicionarReferencia(nota, proposta, 'Referência selecionada para a fala: Tenho medo.')
    expect(nova.revisao).toBe(1)
    expect(nova.frases[0]).toEqual(nota.frases[0])
    expect(nova.frases[1]).toMatchObject({ secao: 'A', ancoras: [{ inicioMs: 100, fimMs: 900 }], referencias: [referencia] })
    expect(adicionarReferencia(nova, proposta, 'Tentativa repetida')).toBe(nova)
    const aberta = lerNota(notaParaEntrada(nova), 'paciente')!
    expect(aberta.frases[1]!.referencias).toEqual([referencia])
    expect(adicionarReferencia(aberta, proposta, 'Tentativa após reabrir')).toBe(aberta)
    expect(editarFrase(aberta, aberta.frases[1]!.id, 'Avaliação revista pelo profissional').frases[1]!.referencias).toEqual([referencia])
  })

  it('não confunde diferentes revisões, fontes, sessões ou frases', () => {
    let nova = adicionarReferencia(nota, proposta, 'Primeira')
    for (const mudanca of [{ trechoId: 'outra' }, { transcriptId: 'outra' }, { revisaoTranscricao: 2 }, { frasePaciente: 'Outra frase.' }]) {
      nova = adicionarReferencia(nova, { ...proposta, referencia: { ...referencia, ...mudanca } }, 'Nova referência')
    }
    expect(nova.frases).toHaveLength(6)
  })

  it.each<{ nota: Nota; proposta: PropostaReferencia }>([
    { nota: { ...nota, estado: ESTADO_ASSINADA }, proposta },
    { nota, proposta: { ...proposta, patientId: 'outro' } },
    { nota, proposta: { ...proposta, referencia: { ...referencia, titulo: '' } } },
    { nota, proposta: { ...proposta, inicioMs: NaN } },
    { nota, proposta: { ...proposta, fimMs: Infinity } },
    { nota, proposta: { ...proposta, inicioMs: -1 } },
    { nota, proposta: { ...proposta, fimMs: 0 } },
  ])('recusa inclusão incompatível %#', item => expect(() => adicionarReferencia(item.nota, item.proposta, 'Texto')).toThrow())

  it('valida cada campo bibliográfico e clínico ao abrir bytes já decifrados', () => {
    expect(lerReferencia(referencia)).toEqual(referencia)
    for (const valor of [null, 3, {}, { ...referencia, titulo: 5 }, { ...referencia, autor: ' ' },
      { ...referencia, pagina: '4' }, { ...referencia, pagina: 1.5 }, { ...referencia, pagina: 0 },
      { ...referencia, paragrafo: null }, { ...referencia, paragrafo: NaN }, { ...referencia, paragrafo: -1 },
      { ...referencia, revisaoTranscricao: true }, { ...referencia, revisaoTranscricao: .5 }, { ...referencia, revisaoTranscricao: -1 }]) {
      expect(lerReferencia(valor)).toBeNull()
    }
  })

  it('a assinatura cobre citação, obra, página, frase e revisão original', async () => {
    const kek = await webcrypto.importKek(new Uint8Array(32))
    const { dek } = await webcrypto.generateWrappedDek(kek, new Uint8Array())
    const nova = adicionarReferencia(nota, proposta, 'Referência selecionada')
    const assinatura = await selarAssinatura(dek, nova.id, nova)
    expect(await verificarAssinatura(dek, nova, assinatura)).toBe(true)
    for (const campo of [{ citacaoLiteral: 'Citação adulterada' }, { pagina: 5 }, { paragrafo: 3 },
      { titulo: 'Outra obra' }, { autor: 'Outro autor' }, { transcriptId: 'outra' }, { revisaoTranscricao: 2 },
      { frasePaciente: 'Frase adulterada' }, { trechoId: 'outra fonte' }]) {
      const adulterada = { ...nova, frases: nova.frases.map(frase => frase.referencias ? { ...frase, referencias: [{ ...referencia, ...campo }] } : frase) }
      expect(await verificarAssinatura(dek, adulterada, assinatura)).toBe(false)
    }
  })
})
