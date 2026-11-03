import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { beginMaterialCapture, releaseMaterialCapture } from './api'
import { acquireMaterialCapture, recoverMaterialCaptures } from './material-capture'
import { dynamicActivate } from '../../shared/i18n'
import { fakeWebLocks } from '../../test-support/web-locks'

vi.mock('./api', () => ({ beginMaterialCapture: vi.fn(), releaseMaterialCapture: vi.fn() }))
const access = { baseUrl: '', accountId: 'owner', accessToken: 'token' }
beforeAll(async () => { await dynamicActivate('pt-BR') })
let locks: ReturnType<typeof fakeWebLocks>
beforeEach(() => { locks = fakeWebLocks(); Object.defineProperty(navigator, 'locks', { value: locks.manager, configurable: true }) })
afterEach(() => { vi.clearAllMocks(); localStorage.clear() })

it('mantém o ID após falha de liberação e permite repetir só essa captura', async () => {
  vi.mocked(beginMaterialCapture).mockResolvedValue({ ok: true })
  vi.mocked(releaseMaterialCapture).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true })
  const capture = await acquireMaterialCapture(access, 'session', ['material'])
  const key = `limmiar/material-capture/${capture.captureId}`
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ accountId: 'owner', sessionId: 'session', captureId: capture.captureId })
  await expect(capture.release(access)).rejects.toThrow('offline')
  expect(localStorage.getItem(key)).not.toBeNull()
  await capture.release(access)
  expect(localStorage.getItem(key)).toBeNull()
  expect(releaseMaterialCapture).toHaveBeenLastCalledWith(access, 'session', capture.captureId)
})

it('usa o token renovado ao liberar uma captura longa', async () => {
  vi.mocked(beginMaterialCapture).mockResolvedValue({ ok: true })
  vi.mocked(releaseMaterialCapture).mockResolvedValue({ ok: true })
  const capture = await acquireMaterialCapture(access, 'session', ['material'])
  const renewed = { ...access, accessToken: 'renewed-token' }

  await capture.release(renewed)

  expect(beginMaterialCapture).toHaveBeenCalledWith(access, 'session', capture.captureId, ['material'])
  expect(releaseMaterialCapture).toHaveBeenCalledWith(renewed, 'session', capture.captureId)
})

it('conserva informação da aquisição quando a resposta de rede se perde', async () => {
  vi.mocked(beginMaterialCapture).mockRejectedValueOnce(new Error('offline'))
  await expect(acquireMaterialCapture(access, 'session', [])).rejects.toThrow('offline')
  const id = vi.mocked(beginMaterialCapture).mock.calls[0]![2]
  expect(localStorage.getItem(`limmiar/material-capture/${id}`)).not.toBeNull()
  expect(releaseMaterialCapture).not.toHaveBeenCalled()
})

it('não libera captura de outra aba viva; depois de crash recupera só marcadores desta sessão', async () => {
  vi.mocked(beginMaterialCapture).mockResolvedValue({ ok: true })
  vi.mocked(releaseMaterialCapture).mockResolvedValue({ ok: true })
  const alive = await acquireMaterialCapture(access, 'session', ['material'])
  expect(await recoverMaterialCaptures(access, 'session')).toBe(1)
  expect(releaseMaterialCapture).not.toHaveBeenCalled()
  expect(await recoverMaterialCaptures({ ...access, accountId: 'other' }, 'session')).toBe(0)
  expect(await recoverMaterialCaptures(access, 'other')).toBe(0)
  locks.active.clear()
  expect(await recoverMaterialCaptures(access, 'session')).toBe(0)
  expect(releaseMaterialCapture).toHaveBeenCalledWith(access, 'session', alive.captureId)
  expect(localStorage.length).toBe(0)
})

it('recupera aquisição com resposta perdida sem depender de expiração', async () => {
  vi.mocked(beginMaterialCapture).mockRejectedValueOnce(new Error('offline'))
  vi.mocked(releaseMaterialCapture).mockResolvedValue({ ok: true })
  await expect(acquireMaterialCapture(access, 'session', [])).rejects.toThrow('offline')
  expect(await recoverMaterialCaptures(access, 'session')).toBe(0)
  expect(localStorage.length).toBe(0)
})
