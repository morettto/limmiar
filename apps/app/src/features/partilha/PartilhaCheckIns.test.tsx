import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import type { CryptoKey } from '@limmiar/crypto'
import { listarVinculos, type Vinculo } from '../../entities/vinculo/api'
import { lerEstadoPartilha, definirPartilha } from '../../entities/partilha/preferencias'
import { chaveDoVinculo } from './partilha'
import { PartilhaCheckIns } from './PartilhaCheckIns'

vi.mock('../../entities/vinculo/api', () => ({
  listarVinculos: vi.fn(),
}))
vi.mock('../../entities/partilha/preferencias', () => ({
  lerEstadoPartilha: vi.fn(),
  definirPartilha: vi.fn(),
}))

const BASE_URL = 'http://api.test'
const ACCOUNT_ID = 'conta-ana'
const ACCESS_TOKEN = 'token-ana'
const KEK = {} as CryptoKey

const VINCULO_MARTA: Vinculo = {
  profissionalAccountId: 'conta-marta',
  pacienteAccountId: ACCOUNT_ID,
  patientId: 'paciente-1',
  vinculadoEm: '2026-01-01T00:00:00.000Z',
  chavePublicaDoPar: new Uint8Array(32).fill(1),
}
const CHAVE_MARTA = chaveDoVinculo(VINCULO_MARTA)

const VINCULO_ONDE_SOU_PROFISSIONAL: Vinculo = {
  profissionalAccountId: ACCOUNT_ID,
  pacienteAccountId: 'conta-outra-paciente',
  patientId: 'paciente-2',
  vinculadoEm: '2026-01-02T00:00:00.000Z',
  chavePublicaDoPar: new Uint8Array(32).fill(2),
}

function renderComponente() {
  return render(
    <I18nProvider i18n={i18n}>
      <PartilhaCheckIns baseUrl={BASE_URL} accountId={ACCOUNT_ID} accessToken={ACCESS_TOKEN} kek={KEK} />
    </I18nProvider>,
  )
}

describe('PartilhaCheckIns', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.mocked(listarVinculos).mockReset()
    vi.mocked(lerEstadoPartilha).mockReset()
    vi.mocked(definirPartilha).mockReset()
  })

  it('shows one checkbox per link where I am the patient, unchecked and "revogado" by default', async () => {
    vi.mocked(listarVinculos).mockResolvedValue({
      ok: true,
      vinculos: [VINCULO_MARTA, VINCULO_ONDE_SOU_PROFISSIONAL],
    })
    vi.mocked(lerEstadoPartilha).mockResolvedValue({ versao: 0, estado: {} })

    renderComponente()

    const checkbox = (await screen.findByRole('checkbox', {
      name: 'Compartilhar check-ins com esta profissional',
    })) as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(
      screen.getByText(
        'Compartilhamento de check-ins desativado. O que muda: os check-ins que você registrar a partir de agora não são compartilhados. O que não muda: os check-ins já compartilhados continuam com a profissional, que pode já tê-los lido, e a Limmiar não consegue apagá-los. O vínculo continua ativo.',
      ),
    ).toBeTruthy()
  })

  it('shows the checkbox checked and the "ativo" text when the toggle is already on', async () => {
    vi.mocked(listarVinculos).mockResolvedValue({ ok: true, vinculos: [VINCULO_MARTA] })
    vi.mocked(lerEstadoPartilha).mockResolvedValue({ versao: 1, estado: { [CHAVE_MARTA]: { checkin: true } } })

    renderComponente()

    const checkbox = (await screen.findByRole('checkbox', {
      name: 'Compartilhar check-ins com esta profissional',
    })) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    expect(
      screen.getByText(
        'Os check-ins que você registrar a partir de agora são compartilhados com esta profissional.',
      ),
    ).toBeTruthy()
  })

  it('shows an alert and a disabled checkbox when reading preferences fails', async () => {
    vi.mocked(listarVinculos).mockResolvedValue({ ok: true, vinculos: [VINCULO_MARTA] })
    vi.mocked(lerEstadoPartilha).mockRejectedValue(new Error('lerEstadoPartilha: falha ao ler preferências'))

    renderComponente()

    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toBe(
      'Não foi possível carregar suas preferências de compartilhamento. Nada novo será compartilhado até que elas carreguem.',
    )
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true)
  })

  it('shows the same alert when listing links fails, without rendering any checkbox', async () => {
    vi.mocked(listarVinculos).mockResolvedValue({ ok: false, code: 'auth.forbidden', params: {} })

    renderComponente()

    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toBe(
      'Não foi possível carregar suas preferências de compartilhamento. Nada novo será compartilhado até que elas carreguem.',
    )
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('turning the checkbox on calls definirPartilha with the link key and shows the "ativo" text', async () => {
    vi.mocked(listarVinculos).mockResolvedValue({ ok: true, vinculos: [VINCULO_MARTA] })
    vi.mocked(lerEstadoPartilha).mockResolvedValue({ versao: 0, estado: {} })
    vi.mocked(definirPartilha).mockResolvedValue({ [CHAVE_MARTA]: { checkin: true } })

    renderComponente()
    const checkbox = await screen.findByRole('checkbox', { name: 'Compartilhar check-ins com esta profissional' })
    fireEvent.click(checkbox)

    await screen.findByText('Os check-ins que você registrar a partir de agora são compartilhados com esta profissional.')
    expect(definirPartilha).toHaveBeenCalledWith({
      baseUrl: BASE_URL,
      accountId: ACCOUNT_ID,
      accessToken: ACCESS_TOKEN,
      kek: KEK,
      chave: CHAVE_MARTA,
      tipo: 'checkin',
      ativa: true,
    })
  })

  it('a write failure (e.g. a second version conflict) shows an alert and keeps the checkbox at the read state', async () => {
    vi.mocked(listarVinculos).mockResolvedValue({ ok: true, vinculos: [VINCULO_MARTA] })
    vi.mocked(lerEstadoPartilha).mockResolvedValue({ versao: 0, estado: {} })
    vi.mocked(definirPartilha).mockRejectedValue(new Error('definirPartilha: conflito de versão persistente'))

    renderComponente()
    const checkbox = (await screen.findByRole('checkbox', {
      name: 'Compartilhar check-ins com esta profissional',
    })) as HTMLInputElement
    fireEvent.click(checkbox)

    await screen.findByRole('alert')
    expect(checkbox.checked).toBe(false)
  })

  it('does not update state after unmounting before the initial load resolves', async () => {
    let resolveLer: (v: { versao: number; estado: Record<string, never> }) => void = () => {}
    vi.mocked(listarVinculos).mockResolvedValue({ ok: true, vinculos: [VINCULO_MARTA] })
    vi.mocked(lerEstadoPartilha).mockReturnValue(
      new Promise((resolve) => {
        resolveLer = resolve
      }),
    )

    const { unmount } = renderComponente()
    unmount()
    resolveLer({ versao: 0, estado: {} })

    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
