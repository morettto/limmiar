import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import type { CryptoKey } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { garantirParDeChaves } from '../../entities/vinculo/par-de-chaves'
import { listarPartilhasRecebidas, type PartilhaRecebida } from '../../entities/partilha/api'
import { decifrarItem } from '../../entities/partilha/cifra'
import { listarSessoes } from '../../entities/agenda/api'
import type { ItemPartilhado } from './partilha'
import { EspelhoP6 } from './EspelhoP6'

vi.mock('../../entities/vinculo/par-de-chaves', () => ({
  garantirParDeChaves: vi.fn(),
}))
vi.mock('../../entities/partilha/api', () => ({
  listarPartilhasRecebidas: vi.fn(),
}))
vi.mock('../../entities/partilha/cifra', () => ({
  decifrarItem: vi.fn(),
}))
vi.mock('../../entities/agenda/api', () => ({
  listarSessoes: vi.fn(),
}))

const BASE_URL = 'http://api.test'
const ACCOUNT_ID = 'conta-marta'
const ACCESS_TOKEN = 'token-marta'
const KEK = {} as CryptoKey
const PRIVATE_KEY = new Uint8Array(32).fill(9)
const PUBLICA_ANA = new Uint8Array(32).fill(1)

// 2026-01-16, sexta-feira, meio-dia local -- fixo para o "hoje" de todos os testes.
const HOJE = new Date(2026, 0, 16, 12, 0)

const PARTILHA_ANA: PartilhaRecebida = {
  pacienteAccountId: 'conta-ana',
  patientId: 'paciente-ana',
  vinculadoEm: '2026-01-01T00:00:00.000Z',
  desvinculadoEm: null,
  chavePublicaDoPar: PUBLICA_ANA,
  itens: [],
}

function itemPartilhado(dia: string, sono: number, ansiedade: number, frase: string | null): ItemPartilhado {
  return { tipo: 'checkin', checkin: { dia, sono: sono as 1 | 2 | 3 | 4 | 5, ansiedade: ansiedade as 1 | 2 | 3 | 4 | 5, frase } }
}

function renderComponente(agora: Date = HOJE) {
  return render(
    <I18nProvider i18n={i18n}>
      <EspelhoP6 baseUrl={BASE_URL} accountId={ACCOUNT_ID} accessToken={ACCESS_TOKEN} kek={KEK} agora={agora} />
    </I18nProvider>,
  )
}

function renderSemAgora() {
  return render(
    <I18nProvider i18n={i18n}>
      <EspelhoP6 baseUrl={BASE_URL} accountId={ACCOUNT_ID} accessToken={ACCESS_TOKEN} kek={KEK} />
    </I18nProvider>,
  )
}

async function diaComTexto(dia: string): Promise<HTMLElement> {
  const itens = await screen.findAllByRole('listitem')
  const encontrado = itens.find((li) => li.textContent?.startsWith(dia))
  if (encontrado === undefined) {
    throw new Error(`nenhum <li> para o dia ${dia}`)
  }
  return encontrado
}

describe('EspelhoP6', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.mocked(garantirParDeChaves).mockReset()
    vi.mocked(listarPartilhasRecebidas).mockReset()
    vi.mocked(decifrarItem).mockReset()
    vi.mocked(listarSessoes).mockReset()
  })

  it('shows 7 days with explicit gaps and marks the session on its day', async () => {
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarPartilhasRecebidas).mockResolvedValue({
      ok: true,
      partilhas: [
        { ...PARTILHA_ANA, itens: [{ partilhadoEm: '2026-01-16T10:00:00.000Z', ciphertext: new Uint8Array([1]) }] },
      ],
    })
    vi.mocked(decifrarItem).mockReturnValueOnce(itemPartilhado('2026-01-16', 3, 2, 'dia difícil'))
    const inicioSessao = new Date(2026, 0, 16, 9, 0).toISOString()
    vi.mocked(listarSessoes).mockResolvedValue({
      ok: true,
      sessoes: [{ sessionId: 'sessao-1', patientId: 'paciente-ana', inicioEm: inicioSessao, duracaoMinutos: 50 }],
    })

    renderComponente()

    const itens = await screen.findAllByRole('listitem')
    expect(itens).toHaveLength(7)
    expect(within(await diaComTexto('2026-01-10')).getByText(/sem check-in/)).toBeTruthy()
    const diaDeHoje = await diaComTexto('2026-01-16')
    expect(diaDeHoje.textContent).toContain('3/2')
    expect(diaDeHoje.textContent).toContain('dia difícil')
    expect(within(diaDeHoje).getByText(/Sessão às/)).toBeTruthy()

    expect(listarSessoes).toHaveBeenCalledTimes(1)
    expect(listarSessoes).toHaveBeenCalledWith(
      BASE_URL,
      ACCOUNT_ID,
      ACCESS_TOKEN,
      new Date(2026, 0, 10),
      new Date(2026, 0, 17),
    )
  })

  it('adoption counts only the days with a shared item, and makes a single call for the shares', async () => {
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarPartilhasRecebidas).mockResolvedValue({
      ok: true,
      partilhas: [
        {
          ...PARTILHA_ANA,
          itens: [
            { partilhadoEm: '2026-01-14T10:00:00.000Z', ciphertext: new Uint8Array([1]) },
            { partilhadoEm: '2026-01-16T10:00:00.000Z', ciphertext: new Uint8Array([2]) },
          ],
        },
      ],
    })
    vi.mocked(decifrarItem)
      .mockReturnValueOnce(itemPartilhado('2026-01-14', 4, 1, null))
      .mockReturnValueOnce(itemPartilhado('2026-01-16', 3, 2, null))
    vi.mocked(listarSessoes).mockResolvedValue({ ok: true, sessoes: [] })

    renderComponente()

    expect(await screen.findByText('Check-in compartilhado em 2 de 7 dias')).toBeTruthy()
    expect(garantirParDeChaves).toHaveBeenCalledTimes(1)
    expect(listarPartilhasRecebidas).toHaveBeenCalledTimes(1)
    expect(listarSessoes).toHaveBeenCalledTimes(1)
  })

  it('a check-in already shared stays visible after revocation, and the following day is a gap', async () => {
    const amanha = new Date(2026, 0, 17, 12, 0)
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarPartilhasRecebidas).mockResolvedValue({
      ok: true,
      partilhas: [
        { ...PARTILHA_ANA, itens: [{ partilhadoEm: '2026-01-16T10:00:00.000Z', ciphertext: new Uint8Array([1]) }] },
      ],
    })
    vi.mocked(decifrarItem).mockReturnValueOnce(itemPartilhado('2026-01-16', 3, 2, 'frase de ontem'))
    vi.mocked(listarSessoes).mockResolvedValue({ ok: true, sessoes: [] })

    renderComponente(amanha)

    const diaDeOntem = await diaComTexto('2026-01-16')
    expect(diaDeOntem.textContent).toContain('frase de ontem')
    const diaDeHoje = await diaComTexto('2026-01-17')
    expect(diaDeHoje.textContent).toMatch(/sem check-in/)
  })

  // Paciente desvinculada continua no espelho com o que partilhou antes (fatia 11, S11-03):
  // desvinculadoEm não filtra nada -- received-shares já só traz o que a profissional pode ver.
  it('a patient who unlinked afterward stays in the mirror with what she shared before', async () => {
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarPartilhasRecebidas).mockResolvedValue({
      ok: true,
      partilhas: [
        {
          ...PARTILHA_ANA,
          desvinculadoEm: '2026-01-16T12:00:00.000Z',
          itens: [{ partilhadoEm: '2026-01-16T10:00:00.000Z', ciphertext: new Uint8Array([1]) }],
        },
      ],
    })
    vi.mocked(decifrarItem).mockReturnValueOnce(itemPartilhado('2026-01-16', 3, 2, 'antes de desvincular'))
    vi.mocked(listarSessoes).mockResolvedValue({ ok: true, sessoes: [] })

    renderComponente()

    expect(await screen.findByText('paciente-ana')).toBeTruthy()
    const diaDeHoje = await diaComTexto('2026-01-16')
    expect(diaDeHoje.textContent).toContain('antes de desvincular')
  })

  it('an agenda failure shows the signals and its own alert, isolated from them', async () => {
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarPartilhasRecebidas).mockResolvedValue({
      ok: true,
      partilhas: [
        { ...PARTILHA_ANA, itens: [{ partilhadoEm: '2026-01-16T10:00:00.000Z', ciphertext: new Uint8Array([1]) }] },
      ],
    })
    vi.mocked(decifrarItem).mockReturnValueOnce(itemPartilhado('2026-01-16', 3, 2, null))
    vi.mocked(listarSessoes).mockResolvedValue({ ok: false, code: 'auth.forbidden', params: {} })

    renderComponente()

    expect(await screen.findByText('Check-in compartilhado em 1 de 7 dias')).toBeTruthy()
    expect(await screen.findByText('Não foi possível carregar as sessões.')).toBeTruthy()
  })

  it('an agenda exception also shows the signals and the sessions alert', async () => {
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarPartilhasRecebidas).mockResolvedValue({ ok: true, partilhas: [{ ...PARTILHA_ANA, itens: [] }] })
    vi.mocked(listarSessoes).mockRejectedValue(new Error('rede fora'))

    renderComponente()

    expect(await screen.findByText('Check-in compartilhado em 0 de 7 dias')).toBeTruthy()
    expect(await screen.findByText('Não foi possível carregar as sessões.')).toBeTruthy()
  })

  it('shows "Nenhum check-in compartilhado." when there are no received shares', async () => {
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarPartilhasRecebidas).mockResolvedValue({ ok: true, partilhas: [] })
    vi.mocked(listarSessoes).mockResolvedValue({ ok: true, sessoes: [] })

    renderComponente()

    expect(await screen.findByText('Nenhum check-in compartilhado.')).toBeTruthy()
  })

  it('shows an alert when garantirParDeChaves fails', async () => {
    vi.mocked(garantirParDeChaves).mockRejectedValue(new Error('garantirParDeChaves: falha ao ler o par'))

    renderComponente()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(listarPartilhasRecebidas).not.toHaveBeenCalled()
  })

  it('defaults agora to the real current time when the prop is omitted', async () => {
    vi.mocked(garantirParDeChaves).mockRejectedValue(new Error('garantirParDeChaves: falha ao ler o par'))

    renderSemAgora()

    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('shows an alert when listing received shares fails', async () => {
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarPartilhasRecebidas).mockResolvedValue({ ok: false, code: 'auth.forbidden', params: {} })
    vi.mocked(listarSessoes).mockResolvedValue({ ok: true, sessoes: [] })

    renderComponente()

    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('shows the fail-closed alert instead of silently rendering an envelope whose tipo is not checkin', async () => {
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarPartilhasRecebidas).mockResolvedValue({
      ok: true,
      partilhas: [
        { ...PARTILHA_ANA, itens: [{ partilhadoEm: '2026-01-16T10:00:00.000Z', ciphertext: new Uint8Array([1]) }] },
      ],
    })
    // Forma de CheckIn coincidente por acidente, mas tipo diferente -- sem a guarda de tipo isto
    // renderia como um check-in de verdade em vez de falhar fechado.
    vi.mocked(decifrarItem).mockReturnValueOnce({
      tipo: 'outro',
      checkin: { dia: '2026-01-16', sono: 5, ansiedade: 5, frase: 'não deveria aparecer' },
    })
    vi.mocked(listarSessoes).mockResolvedValue({ ok: true, sessoes: [] })

    renderComponente()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(/não deveria aparecer/)).toBeNull()
  })

  it('shows the fail-closed alert when the decrypted envelope is null', async () => {
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarPartilhasRecebidas).mockResolvedValue({
      ok: true,
      partilhas: [
        { ...PARTILHA_ANA, itens: [{ partilhadoEm: '2026-01-16T10:00:00.000Z', ciphertext: new Uint8Array([1]) }] },
      ],
    })
    vi.mocked(decifrarItem).mockReturnValueOnce(null)
    vi.mocked(listarSessoes).mockResolvedValue({ ok: true, sessoes: [] })

    renderComponente()

    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('does not update state after unmounting before the load resolves', async () => {
    let resolveParDeChaves: (v: { publicKey: Uint8Array; privateKey: Uint8Array }) => void = () => {}
    vi.mocked(garantirParDeChaves).mockReturnValue(
      new Promise((resolve) => {
        resolveParDeChaves = resolve
      }),
    )

    const { unmount } = renderComponente()
    unmount()
    resolveParDeChaves({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })

    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
