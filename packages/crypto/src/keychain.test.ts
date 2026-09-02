import { describe, expect, it } from 'vitest'
import { deriveKey } from './argon2id'
import { createKeychain } from './keychain'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('createKeychain — initial state', () => {
  it('starts locked', () => {
    const keychain = createKeychain()

    expect(keychain.getState()).toBe('locked')
  })
})

describe('createKeychain — unlock happy path', () => {
  it('reports "unlocking" while deriveKek is pending, then "unlocked" once it resolves', async () => {
    const keychain = createKeychain()
    const deferred = createDeferred<Uint8Array>()

    const unlockPromise = keychain.unlock(() => deferred.promise)

    expect(keychain.getState()).toBe('unlocking')

    deferred.resolve(new Uint8Array(32).fill(0x01))
    await unlockPromise

    expect(keychain.getState()).toBe('unlocked')
  })
})

describe('createKeychain — concurrent unlock is rejected', () => {
  it('throws synchronously, without changing state, when called again while unlocking', async () => {
    const keychain = createKeychain()
    const deferred = createDeferred<Uint8Array>()
    const firstUnlock = keychain.unlock(() => deferred.promise)

    expect(() => keychain.unlock(() => Promise.resolve(new Uint8Array(32)))).toThrow(
      'cannot unlock keychain while it is "unlocking"',
    )
    expect(keychain.getState()).toBe('unlocking')

    deferred.resolve(new Uint8Array(32).fill(0x02))
    await firstUnlock
  })

  it('throws synchronously, without changing state, when called again while unlocked', async () => {
    const keychain = createKeychain()
    await keychain.unlock(() => Promise.resolve(new Uint8Array(32).fill(0x03)))

    expect(() => keychain.unlock(() => Promise.resolve(new Uint8Array(32)))).toThrow(
      'cannot unlock keychain while it is "unlocked"',
    )
    expect(keychain.getState()).toBe('unlocked')
  })
})

describe('createKeychain — lock from unlocked', () => {
  it('moves to locked and makes wrapDek/unwrapDek throw', async () => {
    const keychain = createKeychain()
    await keychain.unlock(() => Promise.resolve(new Uint8Array(32).fill(0x04)))

    keychain.lock()

    expect(keychain.getState()).toBe('locked')
    expect(() => keychain.wrapDek(new Uint8Array(32), new Uint8Array())).toThrow(
      'cannot wrap DEK while keychain is "locked"',
    )
    expect(() => keychain.unwrapDek(new Uint8Array(48), new Uint8Array())).toThrow(
      'cannot unwrap DEK while keychain is "locked"',
    )
  })
})

describe('createKeychain — lock while already locked', () => {
  it('is a no-op that does not throw', () => {
    const keychain = createKeychain()

    expect(() => keychain.lock()).not.toThrow()
    expect(keychain.getState()).toBe('locked')
  })
})

describe('createKeychain — lock during an in-flight unlock', () => {
  it('discards and zeroes the stale KEK instead of adopting it, once the race resolves', async () => {
    const keychain = createKeychain()
    const deferred = createDeferred<Uint8Array>()
    const staleKek = new Uint8Array(32).fill(0x05)

    const unlockPromise = keychain.unlock(() => deferred.promise)
    keychain.lock()

    expect(keychain.getState()).toBe('locked')

    deferred.resolve(staleKek)
    await unlockPromise

    expect(keychain.getState()).toBe('locked')
    expect(() => keychain.wrapDek(new Uint8Array(32), new Uint8Array())).toThrow(
      'cannot wrap DEK while keychain is "locked"',
    )
    expect(() => keychain.unwrapDek(new Uint8Array(48), new Uint8Array())).toThrow(
      'cannot unwrap DEK while keychain is "locked"',
    )
    expect(staleKek).toEqual(new Uint8Array(32))
  })
})

describe('createKeychain — unlock failure', () => {
  it('rejects with the original error, unchanged, and returns to locked', async () => {
    const keychain = createKeychain()
    const originalError = new Error('deliberate failure from deriveKek')

    await expect(keychain.unlock(() => Promise.reject(originalError))).rejects.toBe(originalError)
    expect(keychain.getState()).toBe('locked')
  })
})

describe('createKeychain — wrap/unwrap round trip', () => {
  it('unwraps what it wrapped while unlocked, then rejects again after lock', async () => {
    const keychain = createKeychain()
    const kek = new Uint8Array(32).fill(0x06)
    const dek = new Uint8Array(32).fill(0x07)
    const aad = new TextEncoder().encode('schema=1;record=abc123')

    await keychain.unlock(() => Promise.resolve(kek))

    const wrapped = keychain.wrapDek(dek, aad)
    const unwrapped = keychain.unwrapDek(wrapped, aad)
    expect(unwrapped).toEqual(dek)

    keychain.lock()

    expect(() => keychain.wrapDek(dek, aad)).toThrow('cannot wrap DEK while keychain is "locked"')
    expect(() => keychain.unwrapDek(wrapped, aad)).toThrow('cannot unwrap DEK while keychain is "locked"')
  })
})

describe('createKeychain — no DEK reachable after lock', () => {
  it('zeroes the exact KEK array reference after lock, even after it was used to wrap a DEK', async () => {
    const keychain = createKeychain()
    const kek = new Uint8Array(32).fill(0x08)
    const dek = new Uint8Array(32).fill(0x09)
    const aad = new Uint8Array([1])

    await keychain.unlock(() => Promise.resolve(kek))
    keychain.wrapDek(dek, aad)

    keychain.lock()

    expect(kek).toEqual(new Uint8Array(32))
  })
})

describe('createKeychain — wrong password vs. tampered ciphertext are indistinguishable', () => {
  // Cheap on purpose: this suite exercises the keychain's own behavior, not
  // Argon2id's cost — real-world params belong to benchmark.ts's job, not a
  // unit test's.
  const cheapParams = { memoryKiB: 8, iterations: 1, parallelism: 1 }
  const salt = new Uint8Array(16).fill(0x0a)
  const aad = new Uint8Array([1, 2, 3])

  async function unwrapWithWrongPassword(): Promise<number> {
    const correctPassword = new TextEncoder().encode('correct horse battery staple')
    const wrongPassword = new TextEncoder().encode('an entirely different password')
    const dek = new Uint8Array(32).fill(0x0b)

    const correctKeychain = createKeychain()
    await correctKeychain.unlock(() => deriveKey(correctPassword, salt, cheapParams))
    const wrapped = correctKeychain.wrapDek(dek, aad)

    const attackerKeychain = createKeychain()
    await attackerKeychain.unlock(() => deriveKey(wrongPassword, salt, cheapParams))

    const start = performance.now()
    expect(() => attackerKeychain.unwrapDek(wrapped, aad)).toThrow()
    return performance.now() - start
  }

  async function unwrapTamperedCiphertext(): Promise<number> {
    const password = new TextEncoder().encode('correct horse battery staple')
    const dek = new Uint8Array(32).fill(0x0b)

    const keychain = createKeychain()
    await keychain.unlock(() => deriveKey(password, salt, cheapParams))
    const wrapped = keychain.wrapDek(dek, aad)
    const tampered = Uint8Array.from(wrapped)
    tampered[0] = (tampered[0] as number) ^ 0x01

    const start = performance.now()
    expect(() => keychain.unwrapDek(tampered, aad)).toThrow()
    return performance.now() - start
  }

  function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number)
  }

  it('both a wrong KEK and a tampered ciphertext make unwrapDek throw', async () => {
    await unwrapWithWrongPassword()
    await unwrapTamperedCiphertext()
  })

  it(
    'unwrapDek takes roughly the same time in both scenarios (gross-regression guard, not a side-channel proof)',
    async () => {
      const sampleSize = 40
      const wrongPasswordTimings: number[] = []
      const tamperedTimings: number[] = []

      for (let i = 0; i < sampleSize; i++) {
        wrongPasswordTimings.push(await unwrapWithWrongPassword())
        tamperedTimings.push(await unwrapTamperedCiphertext())
      }

      const wrongPasswordMedian = median(wrongPasswordTimings)
      const tamperedMedian = median(tamperedTimings)

      // Statistical timing in CI is noisy, so the tolerance is loose on purpose: it
      // catches a gross regression (an early return that skips real work), not a
      // nanosecond side channel — that is the external ASVS L3 review's job.
      const ratio = Math.max(wrongPasswordMedian, tamperedMedian) / Math.min(wrongPasswordMedian, tamperedMedian)
      expect(ratio).toBeLessThan(3)
    },
    20000,
  )
})
