import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from '@limmiar/crypto'
import { dynamicActivate } from '../../shared/i18n'
import { obterAssinatura } from './api'
import { abrirNotas } from './abrir-notas'
import { notaParaEntrada, selarAssinatura } from './nota-crypto'
import { ESTADO_PENDENTE, ESTADO_ASSINADA, type Nota } from './nota'

vi.mock('./api', () => ({ obterAssinatura: vi.fn() }))
const assinatura = vi.mocked(obterAssinatura)
const nota: Nota = { id: 'nota-real', patientId: 'paciente', atendimentoId: 'atendimento-real', revisao: 1, estado: ESTADO_PENDENTE,
  frases: [{ id: 'S-0', secao: 'S', texto: 'Relato sintético do paciente.', ancoras: [] }] }
const kek = await webcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
const { dek } = await webcrypto.generateWrappedDek(kek, new Uint8Array())
const abrir = (bytes: Uint8Array[]) => abrirNotas(bytes, nota.patientId, dek, '', 'conta', 'token')
beforeAll(async () => dynamicActivate('pt-BR'))
beforeEach(() => assinatura.mockReset())

describe('notas recuperadas do prontuário', () => {
  it('recupera a última revisão e verifica a assinatura real, ignorando entradas de outros tipos', async () => {
    const signature = await selarAssinatura(dek, nota.id, nota)
    assinatura.mockResolvedValue({ ok: true, noteId: nota.id, revision: nota.revisao, signedAt: '2026-10-03', signature })
    const bytes = [new TextEncoder().encode('{"tipo":"transcricao"}'), notaParaEntrada({ ...nota, revisao: 0 }), notaParaEntrada(nota)]
    const abertas = await abrir(bytes)
    expect(abertas).toHaveLength(1)
    expect(abertas[0]).toMatchObject({ id: nota.id, revisao: 1, estado: ESTADO_ASSINADA, frases: [{ texto: nota.frases[0]!.texto }] })
    expect(assinatura).toHaveBeenCalledOnce()
    expect(assinatura).toHaveBeenCalledWith('', 'conta', 'token', nota.id)
  })
  it('reconhece nota pendente somente quando a API informa assinatura ausente', async () => {
    assinatura.mockResolvedValue({ ok: false, code: 'notes.signature_not_found', params: {} })
    expect((await abrir([notaParaEntrada(nota)]))[0]!.estado).toBe(ESTADO_PENDENTE)
    assinatura.mockResolvedValue({ ok: false, code: 'auth.forbidden', params: {} })
    await expect(abrir([notaParaEntrada(nota)])).rejects.toThrow('Você não tem acesso')
  })
  it('recusa revisão divergente e conteúdo alterado depois da assinatura', async () => {
    const signature = await selarAssinatura(dek, nota.id, nota)
    assinatura.mockResolvedValue({ ok: true, noteId: nota.id, revision: 0, signedAt: '2026-10-03', signature })
    await expect(abrir([notaParaEntrada(nota)])).rejects.toThrow('revisão do prontuário')
    assinatura.mockResolvedValue({ ok: true, noteId: nota.id, revision: 1, signedAt: '2026-10-03', signature })
    const adulterada = { ...nota, frases: [{ ...nota.frases[0]!, texto: 'Texto diferente do assinado.' }] }
    await expect(abrir([notaParaEntrada(adulterada)])).rejects.toThrow('assinatura não corresponde')
  })
})
