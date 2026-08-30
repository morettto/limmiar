import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { webcrypto as limmiarWebcrypto, type CryptoKey } from '@limmiar/crypto'
import { dynamicActivate, i18n } from '../../shared/i18n'
import type { ItemFila } from '../../features/nota-fila/FilaAssinatura'
import type { Nota } from '../../entities/nota/nota'
import { construirIndice, notaParaDoc, serializarIndice } from '../../features/nota-biblioteca/indice'
import { selarIndice } from '../../features/nota-biblioteca/indice-crypto'
import { BibliotecaPage, type BibliotecaPageProps } from './BibliotecaPage'

vi.mock('../../widgets/biblioteca/BibliotecaNotas', () => ({
  BibliotecaNotas: vi.fn(() => <div data-testid="biblioteca-notas" />),
}))

const ACCOUNT_ID = '77777777-7777-7777-7777-777777777777'

async function makeDek(): Promise<CryptoKey> {
  const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
  const { dek } = await limmiarWebcrypto.generateWrappedDek(kek, new Uint8Array())
  return dek
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const ITENS: readonly ItemFila[] = [{ id: 'nota-1', patientId: 'paciente-1', estado: 'pendente' }]

function nota(): Nota {
  return {
    id: 'nota-1',
    patientId: 'paciente-1',
    revisao: 0,
    frases: [{ id: 'S-0', secao: 'S', texto: 'termo-supersecreto-xyz', ancoras: [] }],
  }
}

async function renderEObterProps(overrides: Partial<BibliotecaPageProps> = {}) {
  const { BibliotecaNotas } = await import('../../widgets/biblioteca/BibliotecaNotas')
  const dek = 'dek' in overrides ? (overrides.dek as CryptoKey | null) : await makeDek()
  const store = overrides.store ?? { ler: vi.fn().mockResolvedValue(null), gravar: vi.fn().mockResolvedValue(undefined) }
  const utils = render(
    <I18nProvider i18n={i18n}>
      <BibliotecaPage
        itens={overrides.itens ?? ITENS}
        notas={overrides.notas ?? [nota()]}
        accountId={overrides.accountId ?? ACCOUNT_ID}
        dek={dek}
        store={store}
      />
    </I18nProvider>,
  )
  const props = () => vi.mocked(BibliotecaNotas).mock.calls.at(-1)![0]
  return { ...utils, props, store }
}

describe('BibliotecaPage', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('critério de aceite 1: o termo buscado nunca sai por nenhum canal de rede', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    const sendBeaconMock = vi.fn().mockReturnValue(true)
    const xhrOpenMock = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => {})
    const wsMock = vi.fn()
    const imgSrcMock = vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(() => {})
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('WebSocket', wsMock)
    // jsdom não define `navigator.sendBeacon` -- stub direto em vez de `vi.spyOn`,
    // e desfeito no fim do teste para não vazar para os seguintes.
    const sendBeaconOriginal = navigator.sendBeacon
    navigator.sendBeacon = sendBeaconMock

    try {
      const { props } = await renderEObterProps()
      await waitFor(() => expect(props().resultado.estado).not.toBe('a-preparar'))

      const termo = 'termo-supersecreto-xyz'
      act(() => props().onTermoChange(termo))
      await Promise.resolve()

      // Prova positiva de zero saída de rede: cada canal foi espiado e nenhum foi
      // sequer chamado -- não basta "o termo não aparece na chamada" quando pode
      // não haver chamada nenhuma (índice de busca é local, ver README do módulo).
      expect(fetchMock).not.toHaveBeenCalled()
      expect(sendBeaconMock).not.toHaveBeenCalled()
      expect(xhrOpenMock).not.toHaveBeenCalled()
      expect(wsMock).not.toHaveBeenCalled()
      expect(imgSrcMock).not.toHaveBeenCalled()
    } finally {
      navigator.sendBeacon = sendBeaconOriginal
      xhrOpenMock.mockRestore()
      imgSrcMock.mockRestore()
    }
  })

  it('store vazio (ler devolve null): constrói o índice a partir de notas e grava exatamente uma vez', async () => {
    const gravar = vi.fn().mockResolvedValue(undefined)
    const store = { ler: vi.fn().mockResolvedValue(null), gravar }
    const { props } = await renderEObterProps({ store })

    await waitFor(() => expect(props().resultado.estado).not.toBe('a-preparar'))

    expect(gravar).toHaveBeenCalledTimes(1)
  })

  it('store já com blob selado: restaura o índice e não grava de novo', async () => {
    const dek = await makeDek()
    const indice = construirIndice([nota()].map(notaParaDoc))
    const selado = await selarIndice(dek, ACCOUNT_ID, serializarIndice(indice))
    const ler = vi.fn().mockResolvedValue(selado)
    const gravar = vi.fn()
    const store = { ler, gravar }
    const { props } = await renderEObterProps({ dek, store })

    await waitFor(() => expect(props().resultado.estado).not.toBe('a-preparar'))

    expect(gravar).not.toHaveBeenCalled()
  })

  it('dek === null: o resultado fica em a-preparar, sem tocar em ler/gravar', async () => {
    const ler = vi.fn()
    const gravar = vi.fn()
    const { props } = await renderEObterProps({ dek: null, store: { ler, gravar } })

    expect(props().resultado.estado).toBe('a-preparar')
    expect(ler).not.toHaveBeenCalled()
    expect(gravar).not.toHaveBeenCalled()
  })

  it('desmontar antes de restaurarIndice resolver não chega a construir/gravar', async () => {
    const lerCall = deferred<Uint8Array<ArrayBuffer> | null>()
    const gravar = vi.fn()
    const store = { ler: vi.fn().mockReturnValue(lerCall.promise), gravar }
    const { unmount } = await renderEObterProps({ store })

    unmount()
    lerCall.resolve(null)
    await lerCall.promise
    await Promise.resolve()

    expect(gravar).not.toHaveBeenCalled()
  })

  it('desmontar antes de persistirIndice resolver não chama o widget de novo', async () => {
    const { BibliotecaNotas } = await import('../../widgets/biblioteca/BibliotecaNotas')
    const gravarCall = deferred<void>()
    const gravar = vi.fn().mockReturnValue(gravarCall.promise)
    const store = { ler: vi.fn().mockResolvedValue(null), gravar }
    const { unmount } = await renderEObterProps({ store })

    await waitFor(() => expect(gravar).toHaveBeenCalledTimes(1))
    const chamadasAntes = vi.mocked(BibliotecaNotas).mock.calls.length

    unmount()
    gravarCall.resolve()
    await gravarCall.promise
    await Promise.resolve()

    expect(vi.mocked(BibliotecaNotas).mock.calls.length).toBe(chamadasAntes)
  })

  it('restaurarIndice rejeita (OPFS negado/corrompido, DEK ou AAD errada): mostra alerta e para de delegar ao widget', async () => {
    const ler = vi.fn().mockRejectedValue(new Error('OPFS negado'))
    const gravar = vi.fn()
    const { props } = await renderEObterProps({ store: { ler, gravar } })

    // Antes do erro, a página ainda delega ao widget (que mostraria "Preparando a busca...").
    expect(props().resultado.estado).toBe('a-preparar')

    expect(await screen.findByRole('alert')).toBeTruthy()
    // A página parou de delegar ao widget -- "Preparando a busca..." não pode continuar
    // visível por trás de um erro que a trava para sempre.
    expect(screen.queryByTestId('biblioteca-notas')).toBeNull()
    expect(gravar).not.toHaveBeenCalled()
  })

  it('desmontar antes de restaurarIndice rejeitar não atualiza o estado de erro', async () => {
    const lerCall = deferred<Uint8Array<ArrayBuffer> | null>()
    const gravar = vi.fn()
    const store = { ler: vi.fn().mockReturnValue(lerCall.promise), gravar }
    const { unmount } = await renderEObterProps({ store })

    unmount()
    lerCall.reject(new Error('OPFS negado'))
    await lerCall.promise.catch(() => {})
    await Promise.resolve()

    expect(screen.queryByRole('alert')).toBeNull()
  })
})
