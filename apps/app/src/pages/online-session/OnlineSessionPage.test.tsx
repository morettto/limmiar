import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { OnlineCall } from '../../features/online-call/OnlineCall'
import { OnlineSessionPage } from './OnlineSessionPage'

vi.mock('../../features/online-call/OnlineCall', () => ({ OnlineCall: vi.fn(() => <div>Chamada</div>) }))
beforeAll(async () => dynamicActivate('pt-BR'))
afterEach(() => { cleanup(); vi.clearAllMocks(); location.hash = '' })
const room = '11111111-2222-3333-4444-555555555555'
const token = 'a'.repeat(64)
function pagina(hash: string) {
  location.hash = hash
  return render(<I18nProvider i18n={i18n}><OnlineSessionPage baseUrl="/api" /></I18nProvider>)
}
describe('convite de sessão online sem identidade', () => {
  it.each(['', `#room=${'-'.repeat(36)}&token=${token}`, `#room=${room}`, `#token=${token}`, `#room=${room}&token=z`,
    `#room=0${room}&token=${token}`, `#room=${room}0&token=${token}`, `#room=${room}&token=0${token}`, `#room=${room}&token=${token}0`])('recusa fragmento inválido %s', hash => {
    pagina(hash)
    expect(screen.getByRole('alert').textContent).toContain('Convite inválido')
    expect(OnlineCall).not.toHaveBeenCalled()
  })
  it('apresenta chamada de paciente apenas com credencial do fragmento', () => {
    pagina(`#room=${room}&token=${token}`)
    expect(screen.getByText('Chamada')).toBeTruthy()
    expect(vi.mocked(OnlineCall).mock.calls[0]![0]).toEqual({ baseUrl: '/api', roomId: room, token, papel: 'patient' })
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
