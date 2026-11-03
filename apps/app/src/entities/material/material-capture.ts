import { i18n } from '@lingui/core'
import { t } from '@lingui/core/macro'
import { beginMaterialCapture, releaseMaterialCapture, type MaterialAccess } from './api'
import { translateProblemCode } from '../../shared/api'

export interface MaterialCapture { captureId: string; release(access: MaterialAccess): Promise<void> }
const PREFIX = 'limmiar/material-capture/'

async function holdCapture(captureId: string): Promise<(() => Promise<void>) | null> {
  if (!navigator.locks) throw new Error(t`Este navegador não permite proteger capturas entre abas.`)
  let unlock!: () => void
  let acquired!: (held: boolean) => void
  let failed!: (error: unknown) => void
  const ready = new Promise<boolean>((resolve, reject) => { acquired = resolve; failed = reject })
  const held = navigator.locks.request(PREFIX + captureId, { ifAvailable: true }, async lock => {
    if (!lock) { acquired(false); return }
    await new Promise<void>(resolve => { unlock = resolve; acquired(true) })
  })
  void held.catch(failed)
  if (!await ready) return null
  return async () => { unlock(); await held }
}

async function release(access: MaterialAccess, sessionId: string, captureId: string) {
  const result = await releaseMaterialCapture(access, sessionId, captureId)
  if (!result.ok) throw new Error(translateProblemCode(result.code, result.params, i18n))
  localStorage.removeItem(PREFIX + captureId)
}

export function pendingMaterialCaptures(accountId: string, sessionId: string): string[] {
  const ids: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!
    if (!key.startsWith(PREFIX)) continue
    try {
      const saved = JSON.parse(localStorage.getItem(key)!) as { accountId: string; sessionId: string; captureId: string }
      if (saved.accountId === accountId && saved.sessionId === sessionId && key === PREFIX + saved.captureId
        && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(saved.captureId)) ids.push(saved.captureId)
    } catch { continue }
  }
  return ids
}

export async function recoverMaterialCaptures(access: MaterialAccess, sessionId: string): Promise<number> {
  let active = 0
  for (const id of pendingMaterialCaptures(access.accountId, sessionId)) {
    const unlock = await holdCapture(id)
    if (!unlock) { active++; continue }
    try { await release(access, sessionId, id) }
    finally { await unlock() }
  }
  return active
}

export async function acquireMaterialCapture(access: MaterialAccess, sessionId: string, materialIds: string[]): Promise<MaterialCapture> {
  const captureId = crypto.randomUUID()
  const unlock = await holdCapture(captureId)
  if (!unlock) throw new Error(t`Não foi possível proteger a captura entre abas.`)
  try {
    localStorage.setItem(PREFIX + captureId, JSON.stringify({ accountId: access.accountId, sessionId, captureId }))
    const result = await beginMaterialCapture(access, sessionId, captureId, materialIds)
    if (!result.ok) throw new Error(translateProblemCode(result.code, result.params, i18n))
  } catch (error) { await unlock(); throw error }
  let releasing: Promise<void> | undefined
  return {
    captureId,
    release(currentAccess) {
      releasing ??= (async () => {
        await release(currentAccess, sessionId, captureId)
        await unlock()
      })().catch(error => { releasing = undefined; throw error })
      return releasing
    },
  }
}
