import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeBase64 } from '../../shared/lib/base64'
import { appendPatientEntry, createPatient, getPatientRecord, listPatients } from './api'

const ACCOUNT_ID = '44444444-4444-4444-4444-444444444444'
const ACCESS_TOKEN = 'access-token-xyz'
const PATIENT_ID = '99999999-9999-9999-9999-999999999999'
const WRAPPED_DEK = new Uint8Array([0x01, 0x02, 0x03])
const CIPHERTEXT = new Uint8Array([0xaa, 0xbb, 0xcc])
const WRAPPED_DEK_BASE64 = encodeBase64(WRAPPED_DEK)
const CIPHERTEXT_BASE64 = encodeBase64(CIPHERTEXT)

describe('createPatient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { patientId, wrappedDek(base64), ciphertext(base64) } with a bearer token and returns patientId + createdAt on 201', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ patientId: PATIENT_ID, createdAt: '2026-08-14T10:00:00Z' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPatient('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, {
      patientId: PATIENT_ID,
      wrappedDek: WRAPPED_DEK,
      ciphertext: CIPHERTEXT,
    })

    expect(result).toEqual({ ok: true, patientId: PATIENT_ID, createdAt: '2026-08-14T10:00:00Z' })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ patientId: PATIENT_ID, wrappedDek: WRAPPED_DEK_BASE64, ciphertext: CIPHERTEXT_BASE64 }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 409 (patient already exists)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Patient already exists',
      status: 409,
      code: 'patients.entry_sequence_conflict',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 409, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPatient('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, {
      patientId: PATIENT_ID,
      wrappedDek: WRAPPED_DEK,
      ciphertext: CIPHERTEXT,
    })

    expect(result).toEqual({ ok: false, code: 'patients.entry_sequence_conflict', params: {} })
  })
})

describe('appendPatientEntry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { sequence, ciphertext(base64) } with a bearer token and returns entryId + sequence + createdAt on 201', async () => {
    const entryId = '77777777-7777-7777-7777-777777777777'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ entryId, sequence: 2, createdAt: '2026-08-14T10:05:00Z' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await appendPatientEntry('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PATIENT_ID, {
      sequence: 2,
      ciphertext: CIPHERTEXT,
    })

    expect(result).toEqual({ ok: true, entryId, sequence: 2, createdAt: '2026-08-14T10:05:00Z' })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/patients/${PATIENT_ID}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ sequence: 2, ciphertext: CIPHERTEXT_BASE64 }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 404 (patient not found)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Patient not found',
      status: 404,
      code: 'patients.not_found',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 404, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await appendPatientEntry('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PATIENT_ID, {
      sequence: 2,
      ciphertext: CIPHERTEXT,
    })

    expect(result).toEqual({ ok: false, code: 'patients.not_found', params: {} })
  })
})

describe('getPatientRecord', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs the record with a bearer token and base64-decodes wrappedDek + every entry ciphertext', async () => {
    const entryId = '66666666-6666-6666-6666-666666666666'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          patientId: PATIENT_ID,
          wrappedDek: WRAPPED_DEK_BASE64,
          createdAt: '2026-08-14T10:00:00Z',
          lastEntryAt: '2026-08-14T10:05:00Z',
          entries: [{ entryId, sequence: 1, ciphertext: CIPHERTEXT_BASE64, createdAt: '2026-08-14T10:00:00Z' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await getPatientRecord('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PATIENT_ID)

    expect(result).toEqual({
      ok: true,
      patientId: PATIENT_ID,
      wrappedDek: WRAPPED_DEK,
      createdAt: '2026-08-14T10:00:00Z',
      lastEntryAt: '2026-08-14T10:05:00Z',
      entries: [{ entryId, sequence: 1, ciphertext: CIPHERTEXT, createdAt: '2026-08-14T10:00:00Z' }],
    })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/patients/${PATIENT_ID}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 404 (unknown or another tenant\'s patient)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Patient not found',
      status: 404,
      code: 'patients.not_found',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 404, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await getPatientRecord('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PATIENT_ID)

    expect(result).toEqual({ ok: false, code: 'patients.not_found', params: {} })
  })
})

describe('listPatients', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs the wallet with a bearer token and base64-decodes wrappedDek + ciphertext per patient', async () => {
    const otherPatientId = '77777777-7777-7777-7777-777777777777'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          patients: [
            { patientId: PATIENT_ID, wrappedDek: WRAPPED_DEK_BASE64, ciphertext: CIPHERTEXT_BASE64, createdAt: '2026-08-14T10:00:00Z' },
            { patientId: otherPatientId, wrappedDek: WRAPPED_DEK_BASE64, ciphertext: CIPHERTEXT_BASE64, createdAt: '2026-08-15T10:00:00Z' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listPatients('http://api.test', ACCOUNT_ID, ACCESS_TOKEN)

    expect(result).toEqual({
      ok: true,
      patients: [
        { patientId: PATIENT_ID, wrappedDek: WRAPPED_DEK, ciphertext: CIPHERTEXT, createdAt: '2026-08-14T10:00:00Z' },
        { patientId: otherPatientId, wrappedDek: WRAPPED_DEK, ciphertext: CIPHERTEXT, createdAt: '2026-08-15T10:00:00Z' },
      ],
    })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/patients`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on a non-2xx response', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      code: 'auth.forbidden',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 403, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listPatients('http://api.test', ACCOUNT_ID, ACCESS_TOKEN)

    expect(result).toEqual({ ok: false, code: 'auth.forbidden', params: {} })
  })
})
