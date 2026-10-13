import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CryptoKey } from '@limmiar/crypto'
import { abrirPerfilDeVoz } from './perfil-de-voz'
import { abrirEmbedding } from '../../entities/voz/voice-crypto'
import { obterCadastroVoz } from '../../entities/voz/voice-enrollment'
import { dynamicActivate } from '../../shared/i18n'

beforeAll(async () => dynamicActivate('pt-BR'))

vi.mock('../../entities/voz/voice-enrollment', () => ({ obterCadastroVoz: vi.fn() }))
vi.mock('../../entities/voz/voice-crypto', () => ({ abrirEmbedding: vi.fn() }))
const kek = {} as CryptoKey
let perfil: number[]

beforeEach(() => {
  perfil = [1, 0, 0.5]
  vi.mocked(obterCadastroVoz).mockResolvedValue({ ok: true, wrappedDek: 'dek', sealedEmbedding: 'sealed' } as never)
  vi.mocked(abrirEmbedding).mockResolvedValue(perfil)
})
afterEach(() => vi.clearAllMocks())

describe('abrirPerfilDeVoz', () => {
  it('decifra o perfil da conta no aparelho e o entrega a quem vai usá-lo', async () => {
    expect(await abrirPerfilDeVoz('', 'conta', 'token', kek, new AbortController().signal)).toBe(perfil)
    expect(obterCadastroVoz).toHaveBeenCalledWith('', 'conta', 'token')
    expect(abrirEmbedding).toHaveBeenCalledWith(kek, 'conta', 'dek', 'sealed')
  })

  it('devolve null, sem abrir nada, quando o profissional não cadastrou a voz', async () => {
    vi.mocked(obterCadastroVoz).mockResolvedValueOnce({ ok: false, code: 'voice.enrollment_not_found', params: {} })
    expect(await abrirPerfilDeVoz('', 'conta', 'token', kek, new AbortController().signal)).toBeNull()
    expect(abrirEmbedding).not.toHaveBeenCalled()
  })

  it('recusa erro da API', async () => {
    vi.mocked(obterCadastroVoz).mockResolvedValueOnce({ ok: false, code: 'auth.invalid_session', params: {} })
    await expect(abrirPerfilDeVoz('', 'conta', 'token', kek, new AbortController().signal)).rejects.toThrow('perfil')
  })

  it('cancelado antes de decifrar, não abre o perfil', async () => {
    const abort = new AbortController()
    vi.mocked(obterCadastroVoz).mockImplementationOnce(async () => { abort.abort(); return { ok: true, wrappedDek: 'dek', sealedEmbedding: 'sealed' } as never })
    await expect(abrirPerfilDeVoz('', 'conta', 'token', kek, abort.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Cancelado' })
    expect(abrirEmbedding).not.toHaveBeenCalled()
  })

  it('cancelado enquanto decifrava, apaga o perfil antes de recusar', async () => {
    const abort = new AbortController()
    vi.mocked(abrirEmbedding).mockImplementationOnce(async () => { abort.abort(); return perfil })
    await expect(abrirPerfilDeVoz('', 'conta', 'token', kek, abort.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Cancelado' })
    expect(perfil.every((valor) => valor === 0)).toBe(true)
  })
})
