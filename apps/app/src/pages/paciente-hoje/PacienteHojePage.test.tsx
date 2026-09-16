import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { guardarCheckIn, lerCheckIns } from '../../entities/checkin/checkin-store'
import { partilharCheckIn } from '../../features/partilha/partilhar-checkin'
import { PacienteHojePage } from './PacienteHojePage'

vi.mock('../../features/partilha/partilhar-checkin', () => ({
  partilharCheckIn: vi.fn(),
}))

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const AGORA = new Date(2026, 0, 15, 10, 0)

async function makeKek(): Promise<CryptoKey> {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return limmiarWebcrypto.importKek(raw)
}

function renderPage(props: {
  accountId: string | null
  kek: CryptoKey | null
  agora?: Date
  partilha?: { baseUrl: string; accessToken: string }
}) {
  return render(
    <I18nProvider i18n={i18n}>
      <PacienteHojePage agora={AGORA} {...props} />
    </I18nProvider>,
  )
}

const PARTILHA_PROP = { baseUrl: 'http://api.test', accessToken: 'token-ana' }

describe('PacienteHojePage', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.mocked(partilharCheckIn).mockReset()
  })

  it('shows a locked status and no form when kek is null', () => {
    renderPage({ accountId: 'acc-1', kek: null })

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull()
  })

  it('3 clicks (sono, ansiedade, guardar) save a check-in for today and show "Guardado"', async () => {
    const kek = await makeKek()
    renderPage({ accountId: ACCOUNT_ID, kek })

    const sonoGroup = screen.getByRole('group', { name: 'Sono' })
    const ansiedadeGroup = screen.getByRole('group', { name: 'Ansiedade' })

    fireEvent.click(within(sonoGroup).getByRole('radio', { name: '3' }))
    fireEvent.click(within(ansiedadeGroup).getByRole('radio', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await screen.findByRole('status')
    expect(screen.getByRole('status').textContent).toBe('Guardado')

    const salvos = await lerCheckIns(kek, ACCOUNT_ID)
    expect(salvos).toEqual([{ dia: '2026-01-15', sono: 3, ansiedade: 2, frase: null }])
  })

  it('clicking Guardar without choosing sono/ansiedade saves nothing', async () => {
    const kek = await makeKek()
    renderPage({ accountId: ACCOUNT_ID, kek })

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.queryByText('Guardado')).toBeNull()
    expect(await lerCheckIns(kek, ACCOUNT_ID)).toEqual([])
  })

  it('an optional frase is saved alongside the levels', async () => {
    const kek = await makeKek()
    renderPage({ accountId: ACCOUNT_ID, kek })

    const sonoGroup = screen.getByRole('group', { name: 'Sono' })
    const ansiedadeGroup = screen.getByRole('group', { name: 'Ansiedade' })
    fireEvent.click(within(sonoGroup).getByRole('radio', { name: '1' }))
    fireEvent.click(within(ansiedadeGroup).getByRole('radio', { name: '5' }))
    fireEvent.change(screen.getByLabelText('Uma frase (opcional)'), { target: { value: 'dia difícil' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await screen.findByText('Guardado')
    expect(await lerCheckIns(kek, ACCOUNT_ID)).toEqual([
      { dia: '2026-01-15', sono: 1, ansiedade: 5, frase: 'dia difícil' },
    ])
  })

  it('renders the 7-day series with gaps shown as "sem registo"', async () => {
    const kek = await makeKek()
    await guardarCheckIn(kek, ACCOUNT_ID, { dia: '2026-01-14', sono: 4, ansiedade: 1, frase: null })

    renderPage({ accountId: ACCOUNT_ID, kek })

    const itens = await screen.findAllByRole('listitem')
    expect(itens).toHaveLength(7)
    expect(itens[5]!.textContent).toContain('2026-01-14: 4/1')
    expect(itens[6]!.textContent).toContain('2026-01-15: sem registo')
  })

  it('shows an alert when saving fails (e.g. localStorage rejects the write)', async () => {
    const kek = await makeKek()
    renderPage({ accountId: ACCOUNT_ID, kek })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    const sonoGroup = screen.getByRole('group', { name: 'Sono' })
    const ansiedadeGroup = screen.getByRole('group', { name: 'Ansiedade' })
    fireEvent.click(within(sonoGroup).getByRole('radio', { name: '2' }))
    fireEvent.click(within(ansiedadeGroup).getByRole('radio', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await screen.findByRole('alert')
    setItemSpy.mockRestore()
  })

  it('shows an alert when the encrypted series fails to open (wrong kek for what is stored)', async () => {
    const kek = await makeKek()
    await guardarCheckIn(kek, ACCOUNT_ID, { dia: '2026-01-14', sono: 4, ansiedade: 1, frase: null })
    const outroKek = await makeKek()

    renderPage({ accountId: ACCOUNT_ID, kek: outroKek })

    await screen.findByRole('alert')
  })

  it('defaults agora to the real current time when the prop is omitted', () => {
    render(
      <I18nProvider i18n={i18n}>
        <PacienteHojePage accountId={null} kek={null} />
      </I18nProvider>,
    )

    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('does not update state after unmounting before the series load resolves', async () => {
    const kek = await makeKek()
    const { unmount } = renderPage({ accountId: ACCOUNT_ID, kek })

    unmount()

    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('does not update state after unmounting before a failed series load rejects', async () => {
    const kek = await makeKek()
    await guardarCheckIn(kek, ACCOUNT_ID, { dia: '2026-01-14', sono: 4, ansiedade: 1, frase: null })
    const outroKek = await makeKek()
    const { unmount } = renderPage({ accountId: ACCOUNT_ID, kek: outroKek })

    unmount()

    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('without the partilha prop, guardar never calls partilharCheckIn', async () => {
    const kek = await makeKek()
    renderPage({ accountId: ACCOUNT_ID, kek })

    const sonoGroup = screen.getByRole('group', { name: 'Sono' })
    const ansiedadeGroup = screen.getByRole('group', { name: 'Ansiedade' })
    fireEvent.click(within(sonoGroup).getByRole('radio', { name: '3' }))
    fireEvent.click(within(ansiedadeGroup).getByRole('radio', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await screen.findByText('Guardado')
    expect(partilharCheckIn).not.toHaveBeenCalled()
  })

  it('with the partilha prop, guardar calls partilharCheckIn and still shows "Guardado" on success', async () => {
    vi.mocked(partilharCheckIn).mockResolvedValue({ partilhadoCom: ['conta-marta'] })
    const kek = await makeKek()
    renderPage({ accountId: ACCOUNT_ID, kek, partilha: PARTILHA_PROP })

    const sonoGroup = screen.getByRole('group', { name: 'Sono' })
    const ansiedadeGroup = screen.getByRole('group', { name: 'Ansiedade' })
    fireEvent.click(within(sonoGroup).getByRole('radio', { name: '3' }))
    fireEvent.click(within(ansiedadeGroup).getByRole('radio', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await screen.findByText('Guardado')
    expect(partilharCheckIn).toHaveBeenCalledWith({
      baseUrl: PARTILHA_PROP.baseUrl,
      accountId: ACCOUNT_ID,
      accessToken: PARTILHA_PROP.accessToken,
      kek,
      checkin: { dia: '2026-01-15', sono: 3, ansiedade: 2, frase: null },
    })
  })

  it('with the partilha prop, when partilharCheckIn throws, shows "salvo-sem-partilha" and keeps the local check-in', async () => {
    vi.mocked(partilharCheckIn).mockRejectedValue(new Error('partilharCheckIn: falha ao enviar item partilhado'))
    const kek = await makeKek()
    renderPage({ accountId: ACCOUNT_ID, kek, partilha: PARTILHA_PROP })

    const sonoGroup = screen.getByRole('group', { name: 'Sono' })
    const ansiedadeGroup = screen.getByRole('group', { name: 'Ansiedade' })
    fireEvent.click(within(sonoGroup).getByRole('radio', { name: '3' }))
    fireEvent.click(within(ansiedadeGroup).getByRole('radio', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await screen.findByText('Check-in salvo neste dispositivo, mas não foi compartilhado.')
    expect(await lerCheckIns(kek, ACCOUNT_ID)).toEqual([{ dia: '2026-01-15', sono: 3, ansiedade: 2, frase: null }])
  })
})
