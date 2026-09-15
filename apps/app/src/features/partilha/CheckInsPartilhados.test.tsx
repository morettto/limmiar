import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import type { CryptoKey } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { listarVinculos, type Vinculo } from '../../entities/vinculo/api'
import { garantirParDeChaves } from '../../entities/vinculo/par-de-chaves'
import { listarItensPartilhados } from '../../entities/partilha/api'
import { decifrarItem } from '../../entities/partilha/cifra'
import type { ItemPartilhado } from './partilha'
import { CheckInsPartilhados } from './CheckInsPartilhados'

vi.mock('../../entities/vinculo/api', () => ({
  listarVinculos: vi.fn(),
}))
vi.mock('../../entities/vinculo/par-de-chaves', () => ({
  garantirParDeChaves: vi.fn(),
}))
vi.mock('../../entities/partilha/api', () => ({
  listarItensPartilhados: vi.fn(),
}))
vi.mock('../../entities/partilha/cifra', () => ({
  decifrarItem: vi.fn(),
}))

const BASE_URL = 'http://api.test'
const ACCOUNT_ID = 'conta-marta'
const ACCESS_TOKEN = 'token-marta'
const KEK = {} as CryptoKey
const PRIVATE_KEY = new Uint8Array(32).fill(9)
const PUBLICA_ANA = new Uint8Array(32).fill(1)

const VINCULO_ANA: Vinculo = {
  profissionalAccountId: ACCOUNT_ID,
  pacienteAccountId: 'conta-ana',
  patientId: 'paciente-ana',
  vinculadoEm: '2026-01-01T00:00:00.000Z',
  chavePublicaDoPar: PUBLICA_ANA,
}

const VINCULO_ONDE_SOU_PACIENTE: Vinculo = {
  profissionalAccountId: 'conta-outra-profissional',
  pacienteAccountId: ACCOUNT_ID,
  patientId: 'paciente-marta',
  vinculadoEm: '2026-01-02T00:00:00.000Z',
  chavePublicaDoPar: new Uint8Array(32).fill(3),
}

function itemPartilhado(dia: string, sono: number, ansiedade: number, frase: string | null): ItemPartilhado {
  return { tipo: 'checkin', checkin: { dia, sono: sono as 1 | 2 | 3 | 4 | 5, ansiedade: ansiedade as 1 | 2 | 3 | 4 | 5, frase } }
}

function renderComponente() {
  return render(
    <I18nProvider i18n={i18n}>
      <CheckInsPartilhados baseUrl={BASE_URL} accountId={ACCOUNT_ID} accessToken={ACCESS_TOKEN} kek={KEK} />
    </I18nProvider>,
  )
}

describe('CheckInsPartilhados', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.mocked(listarVinculos).mockReset()
    vi.mocked(garantirParDeChaves).mockReset()
    vi.mocked(listarItensPartilhados).mockReset()
    vi.mocked(decifrarItem).mockReset()
  })

  it('lists the decrypted check-ins for a link where I am the professional, keeping only the last per day', async () => {
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarVinculos).mockResolvedValue({ ok: true, vinculos: [VINCULO_ANA, VINCULO_ONDE_SOU_PACIENTE] })
    vi.mocked(listarItensPartilhados).mockResolvedValue({
      ok: true,
      itens: [
        { partilhadoEm: '2026-01-14T10:00:00.000Z', ciphertext: new Uint8Array([1]) },
        { partilhadoEm: '2026-01-15T10:00:00.000Z', ciphertext: new Uint8Array([2]) },
        { partilhadoEm: '2026-01-15T18:00:00.000Z', ciphertext: new Uint8Array([3]) },
      ],
    })
    vi.mocked(decifrarItem)
      .mockReturnValueOnce(itemPartilhado('2026-01-14', 4, 1, null))
      .mockReturnValueOnce(itemPartilhado('2026-01-15', 3, 2, 'dia difícil'))
      .mockReturnValueOnce(itemPartilhado('2026-01-15', 2, 2, 'melhorou à noite'))

    renderComponente()

    const itens = await screen.findAllByRole('listitem')
    expect(itens.map((li) => li.textContent)).toEqual(['2026-01-14: 4/1', '2026-01-15: 2/2 · melhorou à noite'])
    expect(listarItensPartilhados).toHaveBeenCalledTimes(1)
    expect(listarItensPartilhados).toHaveBeenCalledWith(BASE_URL, ACCOUNT_ID, ACCESS_TOKEN, 'conta-ana')
    expect(decifrarItem).toHaveBeenNthCalledWith(1, {
      privadaProfissional: PRIVATE_KEY,
      publicaPaciente: PUBLICA_ANA,
      pacienteAccountId: 'conta-ana',
      profissionalAccountId: ACCOUNT_ID,
      ciphertext: new Uint8Array([1]),
    })
  })

  it('shows "Nenhum check-in compartilhado." when a link has no shared item', async () => {
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarVinculos).mockResolvedValue({ ok: true, vinculos: [VINCULO_ANA] })
    vi.mocked(listarItensPartilhados).mockResolvedValue({ ok: true, itens: [] })

    renderComponente()

    expect(await screen.findByText('Nenhum check-in compartilhado.')).toBeTruthy()
  })

  it('shows "Nenhum check-in compartilhado." when there is no link where I am the professional', async () => {
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarVinculos).mockResolvedValue({ ok: true, vinculos: [VINCULO_ONDE_SOU_PACIENTE] })

    renderComponente()

    expect(await screen.findByText('Nenhum check-in compartilhado.')).toBeTruthy()
    expect(listarItensPartilhados).not.toHaveBeenCalled()
  })

  it('shows an alert when garantirParDeChaves fails', async () => {
    vi.mocked(garantirParDeChaves).mockRejectedValue(new Error('garantirParDeChaves: falha ao ler o par'))

    renderComponente()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(listarVinculos).not.toHaveBeenCalled()
  })

  it('shows an alert when listing links fails', async () => {
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarVinculos).mockResolvedValue({ ok: false, code: 'auth.forbidden', params: {} })

    renderComponente()

    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('shows an alert when listing the shared items of a link fails', async () => {
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarVinculos).mockResolvedValue({ ok: true, vinculos: [VINCULO_ANA] })
    vi.mocked(listarItensPartilhados).mockResolvedValue({ ok: false, code: 'link.not_found', params: {} })

    renderComponente()

    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('shows the fail-closed alert instead of silently rendering an envelope whose tipo is not checkin', async () => {
    vi.mocked(garantirParDeChaves).mockResolvedValue({ publicKey: new Uint8Array(), privateKey: PRIVATE_KEY })
    vi.mocked(listarVinculos).mockResolvedValue({ ok: true, vinculos: [VINCULO_ANA] })
    vi.mocked(listarItensPartilhados).mockResolvedValue({
      ok: true,
      itens: [{ partilhadoEm: '2026-01-14T10:00:00.000Z', ciphertext: new Uint8Array([1]) }],
    })
    // Forma de CheckIn coincidente por acidente, mas tipo diferente -- sem a guarda de tipo isto
    // renderia como um check-in de verdade em vez de falhar fechado.
    vi.mocked(decifrarItem).mockReturnValueOnce({
      tipo: 'outro',
      checkin: { dia: '2026-01-14', sono: 5, ansiedade: 5, frase: 'não deveria aparecer' },
    })

    renderComponente()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(/não deveria aparecer/)).toBeNull()
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
