import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { NotaPage } from './NotaPage'

vi.mock('../../widgets/soap-editor/FilaEEditor', () => ({
  FilaEEditor: vi.fn(() => <div data-testid="fila-e-editor" />),
}))
vi.mock('../../entities/patient/patient-crypto', () => ({
  openRecord: vi.fn(),
  sealEntry: vi.fn(),
}))
vi.mock('../../entities/nota/nota-crypto', () => ({
  selarAssinatura: vi.fn(),
  notaParaEntrada: vi.fn(() => new Uint8Array([9, 9])),
}))
vi.mock('../../entities/patient/api', () => ({ appendPatientEntry: vi.fn() }))
vi.mock('../../entities/nota/api', () => ({ assinarNota: vi.fn() }))

const DEK = {} as CryptoKey
const CIPHERTEXT = new Uint8Array([1, 2, 3])
const SIGNATURE = new Uint8Array([4, 5, 6])
const SIGNED_AT = '2026-08-27T10:05:00Z'

function renderNotaPage() {
  return render(
    <I18nProvider i18n={i18n}>
      <NotaPage />
    </I18nProvider>,
  )
}

async function renderEObterProps() {
  renderNotaPage()
  const { FilaEEditor } = await import('../../widgets/soap-editor/FilaEEditor')
  const props = () => vi.mocked(FilaEEditor).mock.calls.at(-1)![0]
  const notaId = props().itens[0]!.id
  return { props, notaId }
}

async function assinar(props: () => { notas: Record<string, import('../../entities/nota/nota').Nota>; aoAssinar: (nota: import('../../entities/nota/nota').Nota) => void }, notaId: string) {
  await act(async () => {
    await (props().aoAssinar(props().notas[notaId]!) as unknown as Promise<void>)
  })
}

describe('NotaPage', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  // O <audio> renderiza sempre com o componente, por isso este ramo não é alcançável pela UI — mas
  // a guarda existe (ADR contra `!`) e precisa deste teste para provar que, com o ref nulo
  // (componente desmontado), aoTocar é um no-op em vez de rebentar.
  it('aoTocar não rebenta se o ref do <audio> estiver nulo', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    renderNotaPage()

    const { FilaEEditor } = await import('../../widgets/soap-editor/FilaEEditor')
    const props = vi.mocked(FilaEEditor).mock.calls[0]![0]

    cleanup() // desmonta o <audio> -- React zera audioRef.current

    expect(() => props.aoTocar({ inicioMs: 1000, fimMs: 2000 })).not.toThrow()
    expect(play).not.toHaveBeenCalled()

    play.mockRestore()
  })

  describe('aoAssinar (fatia 5 -- ligação real ao prontuário e à assinatura)', () => {
    beforeEach(async () => {
      const { openRecord, sealEntry } = await import('../../entities/patient/patient-crypto')
      const { selarAssinatura } = await import('../../entities/nota/nota-crypto')
      const { appendPatientEntry } = await import('../../entities/patient/api')
      const { assinarNota } = await import('../../entities/nota/api')
      vi.mocked(openRecord).mockResolvedValue({ dek: DEK, plaintexts: [] })
      vi.mocked(sealEntry).mockResolvedValue(CIPHERTEXT)
      vi.mocked(selarAssinatura).mockResolvedValue(SIGNATURE)
      vi.mocked(appendPatientEntry).mockResolvedValue({
        ok: true,
        entryId: 'entry-1',
        sequence: 1,
        createdAt: '2026-08-27T09:00:00Z',
      })
      vi.mocked(assinarNota).mockResolvedValue({ ok: true, noteId: 'nota-fixture-1', revisao: 0, signedAt: SIGNED_AT })
    })

    it('chama appendPatientEntry antes de assinarNota, com sequence = entries.length + 1', async () => {
      const { props, notaId } = await renderEObterProps()
      const { appendPatientEntry } = await import('../../entities/patient/api')
      const { assinarNota } = await import('../../entities/nota/api')

      await assinar(props, notaId)

      expect(vi.mocked(appendPatientEntry)).toHaveBeenCalledWith('', '', '', 'paciente-fixture-1', {
        sequence: 1,
        ciphertext: CIPHERTEXT,
      })
      const ordemAppend = vi.mocked(appendPatientEntry).mock.invocationCallOrder[0]!
      const ordemAssinar = vi.mocked(assinarNota).mock.invocationCallOrder[0]!
      expect(ordemAppend).toBeLessThan(ordemAssinar)
    })

    it('sucesso marca só o item com nota.id como assinada e anuncia a data em role=status', async () => {
      const { props, notaId } = await renderEObterProps()

      await assinar(props, notaId)

      const propsDepois = props()
      expect(propsDepois.itens.find((item) => item.id === notaId)?.estado).toBe('assinada')
      const status = screen.getByRole('status')
      expect(status.textContent).toContain(new Date(SIGNED_AT).toLocaleString())
    })

    it('não marca o item de uma nota diferente -- prova que o filtro é por nota.id, não "todos os itens" (dívida da fatia 3)', async () => {
      const { props, notaId } = await renderEObterProps()
      const notaDeOutraId = { ...props().notas[notaId]!, id: 'outra-nota-id' }

      await act(async () => {
        await (props().aoAssinar(notaDeOutraId) as unknown as Promise<void>)
      })
      expect(props().itens.find((item) => item.id === notaId)?.estado).toBe('pendente')

      // Sem este segundo assinar, a asserção acima passa mesmo com aoAssinar em no-op --
      // não prova o filtro por nota.id, só que nada aconteceu. Assinar a nota real a
      // seguir é que constrange: só marca 'assinada' quem tem o id certo.
      await assinar(props, notaId)
      expect(props().itens.find((item) => item.id === notaId)?.estado).toBe('assinada')
    })

    it('409 notes.already_signed marca o item assinado e mostra role=alert', async () => {
      const { assinarNota } = await import('../../entities/nota/api')
      vi.mocked(assinarNota).mockResolvedValue({ ok: false, code: 'notes.already_signed', params: {} })

      const { props, notaId } = await renderEObterProps()
      await assinar(props, notaId)

      const propsDepois = props()
      expect(propsDepois.itens.find((item) => item.id === notaId)?.estado).toBe('assinada')
      expect(screen.getByRole('alert')).toBeTruthy()
    })

    it('falha de rede mostra role=alert e o item continua pendente', async () => {
      const { assinarNota } = await import('../../entities/nota/api')
      vi.mocked(assinarNota).mockRejectedValue(new Error('network down'))

      const { props, notaId } = await renderEObterProps()
      await assinar(props, notaId)

      const propsDepois = props()
      expect(propsDepois.itens.find((item) => item.id === notaId)?.estado).toBe('pendente')
      expect(screen.getByRole('alert')).toBeTruthy()
    })

    it('appendPatientEntry não-ok (conflito de sequência) não chama assinarNota, item continua pendente, e mostra role=alert', async () => {
      const { appendPatientEntry } = await import('../../entities/patient/api')
      const { assinarNota } = await import('../../entities/nota/api')
      vi.mocked(appendPatientEntry).mockResolvedValue({
        ok: false,
        code: 'patients.entry_sequence_conflict',
        params: {},
      })

      const { props, notaId } = await renderEObterProps()
      await assinar(props, notaId)

      expect(vi.mocked(assinarNota)).not.toHaveBeenCalled()
      const propsDepois = props()
      expect(propsDepois.itens.find((item) => item.id === notaId)?.estado).toBe('pendente')
      expect(screen.getByRole('alert')).toBeTruthy()
    })

    it('segundo ⌘↵ depois da falha de rede não repete o appendPatientEntry da mesma revisão', async () => {
      const { assinarNota } = await import('../../entities/nota/api')
      const { appendPatientEntry } = await import('../../entities/patient/api')
      vi.mocked(assinarNota).mockRejectedValueOnce(new Error('network down'))

      const { props, notaId } = await renderEObterProps()

      await assinar(props, notaId)
      expect(vi.mocked(appendPatientEntry)).toHaveBeenCalledTimes(1)

      await assinar(props, notaId)
      expect(vi.mocked(appendPatientEntry)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(assinarNota)).toHaveBeenCalledTimes(2)
    })
  })
})
