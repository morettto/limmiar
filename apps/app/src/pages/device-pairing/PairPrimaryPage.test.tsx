import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import * as accountKeys from '../../entities/account/account-keys'
import { PairPrimaryPage } from './PairPrimaryPage'

vi.mock('../../features/device-pairing-primary/PairPrimaryDevice', () => ({
  PairPrimaryDevice: ({ getKekForTransfer }: { getKekForTransfer: () => Promise<Uint8Array> }) => <button type="button" onClick={() => void getKekForTransfer()}>Transferir</button>,
}))

const kek = {} as CryptoKey

function pagina() {
  return render(<I18nProvider i18n={i18n}><PairPrimaryPage baseUrl="http://api.test" accountId="conta" accessToken="token" email="pro@example.com" kek={kek} /></I18nProvider>)
}

describe('PairPrimaryPage', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('pede a senha atual, vazia, antes de gerar o código de pareamento', () => {
    pagina()
    expect(screen.getByLabelText('Senha atual')).toHaveProperty('value', '')
    expect(screen.queryByRole('button', { name: 'Transferir' })).toBeNull()
  })

  it('usa a senha digitada uma única vez para reconstituir a chave e a esquece em seguida', async () => {
    const derivar = vi.spyOn(accountKeys, 'deriveAccountKekForTransfer').mockResolvedValue(new Uint8Array(32))
    pagina()
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'senha-secreta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gerar código de pareamento' }))

    fireEvent.click(screen.getByRole('button', { name: 'Transferir' }))
    expect(derivar).toHaveBeenLastCalledWith('senha-secreta', 'pro@example.com', kek)
    fireEvent.click(screen.getByRole('button', { name: 'Transferir' }))
    expect(derivar).toHaveBeenLastCalledWith('', 'pro@example.com', kek)
  })
})
