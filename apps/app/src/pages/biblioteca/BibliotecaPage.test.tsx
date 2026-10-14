import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { ESTADO_PENDENTE, type Nota } from '../../entities/nota/nota'
import type { Account } from '../../entities/account'
import { SessionContext, type ContextoSessao } from '../../entities/account/session-context'
import { construirIndice, impressaoDigital, notaParaDoc, serializarIndice } from '../../features/nota-biblioteca/indice'
import { chaveIndiceDaConta, selarIndice, type ChaveIndiceBusca } from '../../features/nota-biblioteca/indice-crypto'
import { deferred } from '../../test-support/deferred'
import { BibliotecaPage, type BibliotecaPageProps } from './BibliotecaPage'


vi.mock('../../widgets/biblioteca/BibliotecaNotas', () => ({
  BibliotecaNotas: vi.fn(() => <div data-testid="biblioteca-notas" />),
}))

const ACCOUNT_ID = '77777777-7777-7777-7777-777777777777'

type Store = BibliotecaPageProps['store']

function sessaoParaConta(accountId: string): Account {
  return {accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',
    id: accountId,
    email: 'user@example.com',
    role: 'Professional',
    twoFactorRequirement: 'NotApplicable',
    twoFactorTicket: null,
  }
}

function sessaoValue(accountId: string | null): ContextoSessao {
  return {kek: null,
    sessao: accountId === null ? null : sessaoParaConta(accountId),
    iniciarSessao: vi.fn(),
    terminarSessao: vi.fn(),
  }
}

// Único wrapper de montagem de BibliotecaPage: `accountId` deixou de ser prop (S18-10) --
// entra via `<SessionContext.Provider>`, e cada chamada monta um provider fresco com o
// `accountId` pedido (`null` vira `sessao: null`).
function montar(props: BibliotecaPageProps, accountId: string | null) {
  return (
    <I18nProvider i18n={i18n}>
      <SessionContext.Provider value={sessaoValue(accountId)}>
        <BibliotecaPage {...props} />
      </SessionContext.Provider>
    </I18nProvider>
  )
}

async function makeChave(): Promise<ChaveIndiceBusca> {
  const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
  return chaveIndiceDaConta(kek)
}

function nota(): Nota {
  return {
    id: 'nota-1',
    patientId: 'paciente-1',
    atendimentoId: 'atendimento-1',
    revisao: 0,
    frases: [{ id: 'S-0', secao: 'S', texto: 'termo-supersecreto-xyz', ancoras: [] }],
    estado: ESTADO_PENDENTE,
  }
}

async function renderEObterProps(overrides: Partial<BibliotecaPageProps> & { accountId?: string | null } = {}) {
  const { BibliotecaNotas } = await import('../../widgets/biblioteca/BibliotecaNotas')
  const chaveIndice =
    'chaveIndice' in overrides ? (overrides.chaveIndice as ChaveIndiceBusca | null) : await makeChave()
  const accountId = 'accountId' in overrides ? (overrides.accountId as string | null) : ACCOUNT_ID
  const store: Store = overrides.store ?? {
    ler: vi.fn().mockResolvedValue(null),
    gravar: vi.fn().mockResolvedValue(undefined),
    apagar: vi.fn().mockResolvedValue(undefined),
  }
  const utils = render(montar({ notas: overrides.notas ?? [nota()], nomesPacientes: new Map(), chaveIndice, store }, accountId))
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
    rerender(montar({ notas: [{ ...notaAtual }], nomesPacientes: new Map(), chaveIndice, store: { ler, gravar, apagar } }, ACCOUNT_ID))
    // `ler` já reflete o rerender espúrio -- `store.ler()` roda até ao primeiro `await`
    // dentro do próprio `act()` do `rerender`. `gravar` não: a cadeia WebCrypto por trás
    // (packages/crypto/src/webcrypto.ts) só termina em ciclos reais do event loop.
    expect(ler).toHaveBeenCalledTimes(1)

    // Disparo legítimo (accountId novo) + `waitFor` sobre `gravar` (idioma já usado acima,
    // "desmontar antes de persistirIndice resolver") ancora a espera num sinal real: se o
    // rerender espúrio também tivesse disparado o efeito, `gravar` chegaria a 3, não 2.
    const OUTRA_CONTA_ID = '88888888-8888-8888-8888-888888888888'
    rerender(montar({ notas: [{ ...notaAtual }], nomesPacientes: new Map(), chaveIndice, store: { ler, gravar, apagar } }, OUTRA_CONTA_ID))
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

  // S08-25: a identidade real do índice é `impressaoDigital(notas)` -- uma mudança de
  // conteúdo em `notas` (sem `chaveIndice`/`accountId` mudar) tem de reindexar sozinha.
  it('rerender do pai com notas de conteúdo diferente (mesma chaveIndice/accountId): reindexa e grava de novo', async () => {
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
    expect(gravar).toHaveBeenCalledTimes(1)

    const notaEditada = { ...notaAtual, revisao: notaAtual.revisao + 1 }
    rerender(montar({ notas: [notaEditada], nomesPacientes: new Map(), chaveIndice, store: { ler, gravar, apagar } }, ACCOUNT_ID))

    await waitFor(() => expect(gravar).toHaveBeenCalledTimes(2))
    expect(ler).toHaveBeenCalledTimes(2)
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

  // S18-04: accountId derivado de `useSession().sessao?.id ?? null` (S18-10: deixou de ser
  // prop) -- mesmo ramo que chaveIndice===null já cobria, sem precisar da sentinela `''` que
  // assertAccountId (entities/insight/voto-store.ts) rejeitaria noutra página.
  it('sem sessão (sessao === null): o resultado fica em a-preparar, sem tocar em ler/gravar', async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 100))

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
        <SessionContext.Provider value={sessaoValue(ACCOUNT_ID)}>
          {/* @ts-expect-error chaveIndiceDaConta é a única porta para ChaveIndiceBusca */}
          <BibliotecaPage notas={[]} nomesPacientes={new Map()} chaveIndice={chaveDePaciente} store={store} />
        </SessionContext.Provider>
      </I18nProvider>,
    )
  })

  it('o campo de busca começa vazio', async () => {
    const { props } = await renderEObterProps()
    expect(props().termo).toBe('')
  })

  it('um índice tardio de notas anteriores nunca substitui o das notas atuais', async () => {
    const chaveIndice = await makeChave()
    const antiga = nota()
    const nova: Nota = { ...antiga, id: 'nota-2', frases: [{ id: 'S-0', secao: 'S', texto: 'outro-assunto-abc', ancoras: [] }] }
    const gravacaoAntiga = deferred<void>()
    const gravar = vi.fn().mockReturnValueOnce(gravacaoAntiga.promise).mockResolvedValue(undefined)
    const store = { ler: vi.fn().mockResolvedValue(null), gravar, apagar: vi.fn() }
    const { rerender, props } = await renderEObterProps({ chaveIndice, notas: [antiga], store })
    await waitFor(() => expect(gravar).toHaveBeenCalledTimes(1))

    rerender(montar({ notas: [nova], nomesPacientes: new Map(), chaveIndice, store }, ACCOUNT_ID))
    await waitFor(() => expect(props().resultado.estado).not.toBe('a-preparar'))
    act(() => props().onTermoChange('assunto'))
    expect(props().resultado).toEqual({ estado: 'pronto', ids: ['nota-2'] })

    await act(async () => { gravacaoAntiga.resolve(); await new Promise((resolve) => setTimeout(resolve, 100)) })

    expect(props().resultado).toEqual({ estado: 'pronto', ids: ['nota-2'] })
  })

  it('uma falha tardia de notas anteriores não acende o alerta sobre a busca atual', async () => {
    const chaveIndice = await makeChave()
    const antiga = nota()
    const nova: Nota = { ...antiga, id: 'nota-2' }
    const leituraAntiga = deferred<Uint8Array<ArrayBuffer> | null>()
    const ler = vi.fn().mockReturnValueOnce(leituraAntiga.promise).mockResolvedValue(null)
    const store = { ler, gravar: vi.fn().mockResolvedValue(undefined), apagar: vi.fn() }
    const { rerender, props } = await renderEObterProps({ chaveIndice, notas: [antiga], store })
    rerender(montar({ notas: [nova], nomesPacientes: new Map(), chaveIndice, store }, ACCOUNT_ID))
    await waitFor(() => expect(props().resultado.estado).not.toBe('a-preparar'))

    await act(async () => { leituraAntiga.reject(new Error('OPFS negado')); await new Promise((resolve) => setTimeout(resolve, 50)) })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('biblioteca-notas')).toBeTruthy()
  })

  it('o alerta de falha tem o texto próprio', async () => {
    const store = { ler: vi.fn().mockRejectedValue(new Error('OPFS negado')), gravar: vi.fn(), apagar: vi.fn() }
    await renderEObterProps({ store })
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível preparar a busca. Tente novamente.')
  })
})
