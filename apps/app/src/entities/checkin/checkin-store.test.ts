import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { guardarCheckIn, lerCheckIns } from './checkin-store'
import type { CheckIn } from './checkin'

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'

async function makeKek(): Promise<CryptoKey> {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return limmiarWebcrypto.importKek(raw)
}

const CHECKIN: CheckIn = { dia: '2026-01-15', sono: 4, ansiedade: 2, frase: 'dia difícil' }

describe('guardarCheckIn / lerCheckIns', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('round-trips: what is saved is what is read back', async () => {
    const kek = await makeKek()

    await guardarCheckIn(kek, ACCOUNT_ID, CHECKIN)
    const lidos = await lerCheckIns(kek, ACCOUNT_ID)

    expect(lidos).toEqual([CHECKIN])
  })

  it('lerCheckIns returns [] when nothing has been saved yet', async () => {
    const kek = await makeKek()

    expect(await lerCheckIns(kek, ACCOUNT_ID)).toEqual([])
  })

  it('never stores the plaintext (frase, "sono") anywhere in localStorage', async () => {
    const kek = await makeKek()

    await guardarCheckIn(kek, ACCOUNT_ID, CHECKIN)

    const raw = window.localStorage.getItem(`limmiar:checkin:${ACCOUNT_ID}`)
    expect(raw).not.toBeNull()
    expect(raw!.includes(CHECKIN.frase!)).toBe(false)
    expect(raw!.includes('sono')).toBe(false)
  })

  it('fails to open under a different kek', async () => {
    const kek = await makeKek()
    const wrongKek = await makeKek()
    await guardarCheckIn(kek, ACCOUNT_ID, CHECKIN)

    await expect(lerCheckIns(wrongKek, ACCOUNT_ID)).rejects.toThrow()
  })

  it('two accounts on the same device do not see each other’s check-ins', async () => {
    const OTHER_ACCOUNT_ID = '22222222-2222-2222-2222-222222222222'
    const kekA = await makeKek()
    const kekB = await makeKek()
    await guardarCheckIn(kekA, ACCOUNT_ID, CHECKIN)

    expect(await lerCheckIns(kekB, OTHER_ACCOUNT_ID)).toEqual([])
  })

  it('a check-in on a new day is kept alongside earlier days, not overwriting them', async () => {
    const kek = await makeKek()
    const ontem: CheckIn = { ...CHECKIN, dia: '2026-01-14' }
    await guardarCheckIn(kek, ACCOUNT_ID, ontem)

    await guardarCheckIn(kek, ACCOUNT_ID, CHECKIN)

    expect(await lerCheckIns(kek, ACCOUNT_ID)).toEqual([ontem, CHECKIN])
  })

  it('a check-in on the same day replaces the earlier one instead of appending', async () => {
    const kek = await makeKek()
    await guardarCheckIn(kek, ACCOUNT_ID, CHECKIN)
    const atualizado: CheckIn = { ...CHECKIN, sono: 1, ansiedade: 5, frase: null }

    await guardarCheckIn(kek, ACCOUNT_ID, atualizado)

    expect(await lerCheckIns(kek, ACCOUNT_ID)).toEqual([atualizado])
  })
})

describe('empty accountId', () => {
  it('guardarCheckIn rejects an empty accountId before touching storage', async () => {
    const kek = await makeKek()

    await expect(guardarCheckIn(kek, '', CHECKIN)).rejects.toThrow(/accountId/)
  })

  it('lerCheckIns rejects an empty accountId', async () => {
    const kek = await makeKek()

    await expect(lerCheckIns(kek, '')).rejects.toThrow(/accountId/)
  })
})
