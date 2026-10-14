import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { webcrypto } from '@limmiar/crypto'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { PairNewPage } from './PairNewPage'

const state = vi.hoisted(() => ({ adopt: null as null | ((bytes: Uint8Array) => Promise<void>), decode: undefined as undefined | (() => Promise<string>) }))
vi.mock('../../features/device-pairing-new/PairNewDevice', () => ({ PairNewDevice: ({ onKekAdopted, decode }: { onKekAdopted(bytes: Uint8Array): Promise<void>; decode?: () => Promise<string> }) => {
  state.adopt = onKekAdopted
  state.decode = decode
  return <div>Pareando</div>
} }))
beforeAll(() => dynamicActivate('pt-BR'))
afterEach(() => { cleanup(); vi.restoreAllMocks(); state.adopt = null })

function montar(onUnlocked = vi.fn()) {
  const view = render(<I18nProvider i18n={i18n}><PairNewPage baseUrl="" onUnlocked={onUnlocked} /></I18nProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Escanear código QR' }))
  return { view, onUnlocked }
}

describe('adoção da chave na página de pareamento', () => {
  it('aceita o QR colado sem abrir a câmera nem manter o campo de texto', async () => {
    render(<I18nProvider i18n={i18n}><PairNewPage baseUrl="" onUnlocked={vi.fn()} /></I18nProvider>)
    fireEvent.change(screen.getByLabelText('Código de pareamento'), { target: { value: '  qr-confirmado  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Usar código de pareamento' }))
    expect(await state.decode!()).toBe('qr-confirmado')
    expect(screen.queryByLabelText('Código de pareamento')).toBeNull()
  })
  it('importa sem extração, apaga a cópia temporária e só então libera o prontuário', async () => {
    const imported = vi.spyOn(webcrypto, 'importKek')
    const { onUnlocked } = montar()
    await act(() => state.adopt!(new Uint8Array(32).fill(5)))
    const key = onUnlocked.mock.calls[0]![0] as CryptoKey
    expect(key.extractable).toBe(false)
    expect(imported.mock.calls[0]![0]).toEqual(new Uint8Array(32))
    expect(screen.getByText('Prontuários desbloqueados neste dispositivo.')).toBeTruthy()
  })

  it('não entrega uma chave importada depois que a página foi fechada', async () => {
    let resolve!: (key: CryptoKey) => void
    const imported = vi.spyOn(webcrypto, 'importKek').mockImplementation(() => new Promise(done => { resolve = done }))
    const { view, onUnlocked } = montar()
    const pending = state.adopt!(new Uint8Array(32).fill(8))
    view.unmount()
    await act(async () => { resolve({} as CryptoKey); await pending })
    expect(onUnlocked).not.toHaveBeenCalled()
    expect(imported.mock.calls[0]![0]).toEqual(new Uint8Array(32))
  })

  it('apaga a cópia mesmo quando a importação falha', async () => {
    const imported = vi.spyOn(webcrypto, 'importKek').mockRejectedValue(new Error('chave inválida'))
    const { onUnlocked } = montar()
    await expect(state.adopt!(new Uint8Array(32).fill(9))).rejects.toThrow('chave inválida')
    expect(imported.mock.calls[0]![0]).toEqual(new Uint8Array(32))
    expect(onUnlocked).not.toHaveBeenCalled()
  })

  it('o campo do código começa vazio e só libera o envio com algum texto além de espaços', () => {
    render(<I18nProvider i18n={i18n}><PairNewPage baseUrl="" onUnlocked={vi.fn()} /></I18nProvider>)
    const campo = screen.getByLabelText('Código de pareamento')
    const enviar = screen.getByRole('button', { name: 'Usar código de pareamento' })
    expect(campo).toHaveProperty('value', '')
    expect(enviar).toHaveProperty('disabled', true)
    fireEvent.change(campo, { target: { value: '   ' } })
    expect(enviar).toHaveProperty('disabled', true)
    fireEvent.change(campo, { target: { value: 'x' } })
    expect(enviar).toHaveProperty('disabled', false)
  })

  it('entrega a chave ao último onUnlocked recebido', async () => {
    const antigo = vi.fn()
    const novo = vi.fn()
    const view = render(<I18nProvider i18n={i18n}><PairNewPage baseUrl="" onUnlocked={antigo} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Escanear código QR' }))
    view.rerender(<I18nProvider i18n={i18n}><PairNewPage baseUrl="" onUnlocked={novo} /></I18nProvider>)
    await act(() => state.adopt!(new Uint8Array(32).fill(5)))
    expect(novo).toHaveBeenCalledOnce()
    expect(antigo).not.toHaveBeenCalled()
  })
})
