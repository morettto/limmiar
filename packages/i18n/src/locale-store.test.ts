import { describe, expect, it } from 'vitest'
import { noopProfileLocaleStore } from './locale-store'

describe('noopProfileLocaleStore', () => {
  it('get() always resolves to null — no profile backend exists yet (S02)', () => {
    expect(noopProfileLocaleStore.get()).toBeNull()
  })

  it('set() is a no-op that does not throw', () => {
    expect(() => noopProfileLocaleStore.set('pt-BR')).not.toThrow()
    expect(noopProfileLocaleStore.set('pt-BR')).toBeUndefined()
  })
})
