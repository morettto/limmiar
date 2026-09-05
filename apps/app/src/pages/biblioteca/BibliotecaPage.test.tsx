import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { ESTADO_PENDENTE, type Nota } from '../../entities/nota/nota'
import { construirIndice, impressaoDigital, notaParaDoc, serializarIndice } from '../../features/nota-biblioteca/indice'
import { chaveIndiceDaConta, selarIndice, type ChaveIndiceBusca } from '../../features/nota-biblioteca/indice-crypto'
import { BibliotecaPage, type BibliotecaPageProps } from './BibliotecaPage'

vi.mock('../../widgets/biblioteca/BibliotecaNotas', () => ({
  BibliotecaNotas: vi.fn(() => <div data-testid="biblioteca-notas" />),
}))

const ACCOUNT_ID = '77777777-7777-7777-7777-777777777777'

async function makeChave(): Promise<ChaveIndiceBusca> {
  const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
  return chaveIndiceDaConta(kek)
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

function nota(): Nota {
  return {
    id: 'nota-1',
    patientId: 'paciente-1',
    revisao: 0,
    frases: [{ id: 'S-0', secao: 'S', texto: 'termo-supersecreto-xyz', ancoras: [] }],
    estado: ESTADO_PENDENTE,
  }
}

async function renderEObterProps(overrides: Partial<BibliotecaPageProps> = {}) {
  const { BibliotecaNotas } = await import('../../widgets/biblioteca/BibliotecaNotas')
  const chaveIndice =
    'chaveIndice' in overrides ? (overrides.chaveIndice as ChaveIndiceBusca | null) : await makeChave()
  const accountId = 'accountId' in overrides ? (overrides.accountId as string | null) : ACCOUNT_ID
  const store = overrides.store ?? {
    ler: vi.fn().mockResolvedValue(null),
    gravar: vi.fn().mockResolvedValue(undefined),
    apagar: vi.fn().mockResolvedValue(undefined),
  }
  const utils = render(
    <I18nProvider i18n={i18n}>
      <BibliotecaPage
        notas={overrides.notas ?? [nota()]}
        accountId={accountId}
        chaveIndice={chaveIndice}
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
    const store = { ler: vi.fn().mockResolvedValue(null), gravar, apagar: vi.fn() }
    const { props } = await renderEObterProps({ store })

    await waitFor(() => expect(props().resultado.estado).not.toBe('a-preparar'))

    expect(gravar).toHaveBeenCalledTimes(1)
  })

  it('store já com blob selado: restaura o índice e não grava de novo', async () => {
    const chaveIndice = await makeChave()
    const notaAtual = nota()
    const indice = construirIndice([notaAtual].map(notaParaDoc))
    const selado = await selarIndice(chaveIndice, ACCOUNT_ID, serializarIndice(indice, impressaoDigital([notaAtual])))
    const ler = vi.fn().mockResolvedValue(selado)
    const gravar = vi.fn()
    const apagar = vi.fn()
    const store = { ler, gravar, apagar }
    const { props } = await renderEObterProps({ chaveIndice, notas: [notaAtual], store })

    await waitFor(() => expect(props().resultado.estado).not.toBe('a-preparar'))

    expect(gravar).not.toHaveBeenCalled()
    expect(apagar).not.toHaveBeenCalled()
  })

  it('rerender do pai com notas/store novos por identidade mas iguais em conteúdo: não repete leitura/gravação de OPFS', async () => {
    const chaveIndice = await makeChave()
    const notaAtual = nota()
    const ler = vi.fn().mockResolvedValue(null)
    const gravar = vi.fn().mockResolvedValue(undefined)
    const apagar = vi.fn().mockResolvedValue(undefined)
    const { rerender, props } = await renderEObterProps({
      chaveIndice,
      notas: [notaAtual],
      store: { ler, gravar, apagar },
    })

    await waitFor(() => expect(props().resultado.estado).not.toBe('a-preparar'))
    expect(ler).toHaveBeenCalledTimes(1)
    expect(gravar).toHaveBeenCalledTimes(1)

    // `notas` e `store` novos por identidade (literais recriados, como um chamador que não
    // memoiza faria) mas com o mesmo conteúdo -- o pai rerenderizando sozinho não pode
    // disparar uma segunda leitura/gravação em OPFS.
    rerender(
      <I18nProvider i18n={i18n}>
        <BibliotecaPage
          notas={[{ ...notaAtual }]}
          accountId={ACCOUNT_ID}
          chaveIndice={chaveIndice}
          store={{ ler, gravar, apagar }}
        />
      </I18nProvider>,
    )
    // `ler` já reflete o rerender espúrio -- `store.ler()` roda até ao primeiro `await`
    // dentro do próprio `act()` do `rerender`. `gravar` não: a cadeia WebCrypto por trás
    // (packages/crypto/src/webcrypto.ts) só termina em ciclos reais do event loop.
    expect(ler).toHaveBeenCalledTimes(1)

    // Disparo legítimo (accountId novo) + `waitFor` sobre `gravar` (idioma já usado acima,
    // "desmontar antes de persistirIndice resolver") ancora a espera num sinal real: se o
    // rerender espúrio também tivesse disparado o efeito, `gravar` chegaria a 3, não 2.
    const OUTRA_CONTA_ID = '88888888-8888-8888-8888-888888888888'
    rerender(
      <I18nProvider i18n={i18n}>
        <BibliotecaPage
          notas={[{ ...notaAtual }]}
          accountId={OUTRA_CONTA_ID}
          chaveIndice={chaveIndice}
          store={{ ler, gravar, apagar }}
        />
      </I18nProvider>,
    )
    await waitFor(() => expect(gravar).toHaveBeenCalledTimes(2))

    expect(ler).toHaveBeenCalledTimes(2)
    expect(gravar).toHaveBeenCalledTimes(2)
  })

  // Ponte do critério de aceite 2/3 do ticket S08-09: a página passa a impressão digital das
  // notas atuais a `restaurarIndice`; um blob selado sob uma impressão antiga (revisão mudou
  // desde a última gravação) é obsoleto -- apaga e reconstrói, não adota o índice desatualizado.
  it('impressão do blob restaurado não bate com as notas atuais: apaga, reconstrói e grava de novo', async () => {
    const chaveIndice = await makeChave()
    const notaAntiga = nota()
    const indiceAntigo = construirIndice([notaAntiga].map(notaParaDoc))
    const selado = await selarIndice(
      chaveIndice,
      ACCOUNT_ID,
      serializarIndice(indiceAntigo, impressaoDigital([notaAntiga])),
    )
    const notaAtual = { ...notaAntiga, revisao: notaAntiga.revisao + 1 }
    const ler = vi.fn().mockResolvedValue(selado)
    const gravar = vi.fn().mockResolvedValue(undefined)
    const apagar = vi.fn().mockResolvedValue(undefined)
    const store = { ler, gravar, apagar }
    const { props } = await renderEObterProps({ chaveIndice, notas: [notaAtual], store })

    await waitFor(() => expect(props().resultado.estado).not.toBe('a-preparar'))

    expect(apagar).toHaveBeenCalledTimes(1)
    expect(gravar).toHaveBeenCalledTimes(1)
  })

  it('chaveIndice === null: o resultado fica em a-preparar, sem tocar em ler/gravar', async () => {
    const ler = vi.fn()
    const gravar = vi.fn()
    const apagar = vi.fn()
    const { props } = await renderEObterProps({ chaveIndice: null, store: { ler, gravar, apagar } })

    expect(props().resultado.estado).toBe('a-preparar')
    expect(ler).not.toHaveBeenCalled()
    expect(gravar).not.toHaveBeenCalled()
  })

  // S18-04: accountId agora é `string | null` -- mesmo ramo que chaveIndice===null já cobria,
  // sem precisar da sentinela `''` que assertAccountId (key-store.ts) rejeitaria noutra página.
  it('accountId === null: o resultado fica em a-preparar, sem tocar em ler/gravar', async () => {
    const ler = vi.fn()
    const gravar = vi.fn()
    const apagar = vi.fn()
    const { props } = await renderEObterProps({ accountId: null, store: { ler, gravar, apagar } })

    expect(props().resultado.estado).toBe('a-preparar')
    expect(ler).not.toHaveBeenCalled()
    expect(gravar).not.toHaveBeenCalled()
  })

  it('desmontar antes de restaurarIndice resolver não chega a construir/gravar', async () => {
    const lerCall = deferred<Uint8Array<ArrayBuffer> | null>()
    const gravar = vi.fn()
    const store = { ler: vi.fn().mockReturnValue(lerCall.promise), gravar, apagar: vi.fn() }
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
    const store = { ler: vi.fn().mockResolvedValue(null), gravar, apagar: vi.fn() }
    const { unmount } = await renderEObterProps({ store })

    await waitFor(() => expect(gravar).toHaveBeenCalledTimes(1))
    const chamadasAntes = vi.mocked(BibliotecaNotas).mock.calls.length

    unmount()
    gravarCall.resolve()
    await gravarCall.promise
    await Promise.resolve()

    expect(vi.mocked(BibliotecaNotas).mock.calls.length).toBe(chamadasAntes)
  })

  it('restaurarIndice rejeita (OPFS negado/corrompido, chave ou AAD errada): mostra alerta e para de delegar ao widget', async () => {
    const ler = vi.fn().mockRejectedValue(new Error('OPFS negado'))
    const gravar = vi.fn()
    const apagar = vi.fn()
    const { props } = await renderEObterProps({ store: { ler, gravar, apagar } })

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
    const store = { ler: vi.fn().mockReturnValue(lerCall.promise), gravar, apagar: vi.fn() }
    const { unmount } = await renderEObterProps({ store })

    unmount()
    lerCall.reject(new Error('OPFS negado'))
    await lerCall.promise.catch(() => {})
    await Promise.resolve()

    expect(screen.queryByRole('alert')).toBeNull()
  })

  // Critério de aceite 2 do ticket S08-10, literal: uma CryptoKey crua (DEK de paciente,
  // ex. `generateWrappedDek`) não compila como `chaveIndice` -- só `ChaveIndiceBusca` de
  // `chaveIndiceDaConta` passa. Prova em compilação, via `tsc --noEmit`, não em runtime.
  it('type: chaveIndice recusa uma CryptoKey crua (DEK de paciente)', async () => {
    const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
    const { dek: chaveDePaciente } = await limmiarWebcrypto.generateWrappedDek(kek, new Uint8Array())
    const store = { ler: vi.fn(), gravar: vi.fn(), apagar: vi.fn() }

    render(
      <I18nProvider i18n={i18n}>
        {/* @ts-expect-error chaveIndiceDaConta é a única porta para ChaveIndiceBusca */}
        <BibliotecaPage notas={[]} accountId={ACCOUNT_ID} chaveIndice={chaveDePaciente} store={store} />
      </I18nProvider>,
    )
  })
})
