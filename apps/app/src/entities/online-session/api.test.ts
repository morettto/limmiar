import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from '../../shared/api/client'
import { criarSessaoOnline, encerrarSessaoOnline } from './api'

vi.mock('../../shared/api/client', () => ({ request: vi.fn() }))
afterEach(() => vi.clearAllMocks())
describe('salas online vinculadas ao prontuário', () => {
  it('cria convite com credenciais distintas usando apenas IDs', async () => {
    const convite = { roomId: 'sala', professionalToken: 'credencial-profissional', patientToken: 'credencial-paciente', expiresAt: 'data' }
    vi.mocked(request).mockResolvedValue({ ok: true, response: new Response(JSON.stringify(convite)) })
    expect(await criarSessaoOnline('/api', 'profissional', 'sessão', 'prontuário')).toEqual({ ok: true, convite })
    expect(request).toHaveBeenCalledExactlyOnceWith('/api', 'POST', '/accounts/profissional/patients/prontuário/online-sessions', undefined, 'sessão')
  })
  it('preserva recusa de criação e de encerramento', async () => {
    const recusa = { ok: false as const, code: 'auth.unauthorized', params: {} }
    vi.mocked(request).mockResolvedValue(recusa)
    expect(await criarSessaoOnline('', 'p', 'a', 'r')).toBe(recusa)
    expect(await encerrarSessaoOnline('', 'p', 'a', 'sala')).toBe(recusa)
  })
  it('encerra a sala autenticada sem solicitar dados do paciente', async () => {
    vi.mocked(request).mockResolvedValue({ ok: true, response: new Response(null, { status: 204 }) })
    expect(await encerrarSessaoOnline('/api', 'p', 'a', 'sala')).toEqual({ ok: true })
    expect(request).toHaveBeenCalledExactlyOnceWith('/api', 'DELETE', '/accounts/p/online-sessions/sala', undefined, 'a')
  })
})
