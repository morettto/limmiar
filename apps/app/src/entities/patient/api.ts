import { request, type ProblemResult } from '../../shared/api'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'

export type CreatePatientResult = { ok: true; patientId: string; createdAt: string } | ProblemResult

// wrappedDek/ciphertext are opaque bytes end to end -- no clinical field is ever a request/response property of its own, everything clinical lives inside ciphertext.
export async function createPatient(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  params: { patientId: string; wrappedDek: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> },
): Promise<CreatePatientResult> {
  const result = await request(
    baseUrl,
    'POST',
    `/accounts/${accountId}/patients`,
    {
      patientId: params.patientId,
      wrappedDek: encodeBase64(params.wrappedDek),
      ciphertext: encodeBase64(params.ciphertext),
    },
    accessToken,
  )

  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as { patientId: string; createdAt: string }
  return { ok: true, patientId: body.patientId, createdAt: body.createdAt }
}

export type AppendPatientEntryResult =
  | { ok: true; entryId: string; sequence: number; createdAt: string }
  | ProblemResult

export async function appendPatientEntry(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  patientId: string,
  params: { sequence: number; ciphertext: Uint8Array<ArrayBuffer> },
): Promise<AppendPatientEntryResult> {
  const result = await request(
    baseUrl,
    'POST',
    `/accounts/${accountId}/patients/${patientId}/entries`,
    { sequence: params.sequence, ciphertext: encodeBase64(params.ciphertext) },
    accessToken,
  )

  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as { entryId: string; sequence: number; createdAt: string }
  return { ok: true, entryId: body.entryId, sequence: body.sequence, createdAt: body.createdAt }
}

export interface PatientRecordEntryResult {
  entryId: string
  sequence: number
  ciphertext: Uint8Array<ArrayBuffer>
  createdAt: string
}

export type GetPatientRecordResult =
  | {
      ok: true
      patientId: string
      wrappedDek: Uint8Array<ArrayBuffer>
      createdAt: string
      lastEntryAt: string
      entries: PatientRecordEntryResult[]
    }
  | ProblemResult

export async function getPatientRecord(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  patientId: string,
): Promise<GetPatientRecordResult> {
  const result = await request(baseUrl, 'GET', `/accounts/${accountId}/patients/${patientId}`, undefined, accessToken)

  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as {
    patientId: string
    wrappedDek: string
    createdAt: string
    lastEntryAt: string
    entries: { entryId: string; sequence: number; ciphertext: string; createdAt: string }[]
  }
  return {
    ok: true,
    patientId: body.patientId,
    wrappedDek: decodeBase64(body.wrappedDek),
    createdAt: body.createdAt,
    lastEntryAt: body.lastEntryAt,
    entries: body.entries.map((entry) => ({
      entryId: entry.entryId,
      sequence: entry.sequence,
      ciphertext: decodeBase64(entry.ciphertext),
      createdAt: entry.createdAt,
    })),
  }
}

export interface PatientSummaryResult {
  patientId: string
  wrappedDek: Uint8Array<ArrayBuffer>
  ciphertext: Uint8Array<ArrayBuffer>
  createdAt: string
}

export type ListPatientsResult = { ok: true; patients: PatientSummaryResult[] } | ProblemResult

export async function listPatients(
  baseUrl: string,
  accountId: string,
  accessToken: string,
): Promise<ListPatientsResult> {
  const result = await request(baseUrl, 'GET', `/accounts/${accountId}/patients`, undefined, accessToken)

  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as {
    patients: { patientId: string; wrappedDek: string; ciphertext: string; createdAt: string }[]
  }
  return {
    ok: true,
    patients: body.patients.map((patient) => ({
      patientId: patient.patientId,
      wrappedDek: decodeBase64(patient.wrappedDek),
      ciphertext: decodeBase64(patient.ciphertext),
      createdAt: patient.createdAt,
    })),
  }
}
