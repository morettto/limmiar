import { webcrypto } from '@limmiar/crypto'

const PRF_INPUT = new TextEncoder().encode('limmiar/patient-kek/prf/v1')

export class PasskeySemCifraError extends Error {}

async function abrirKek(credential: PublicKeyCredential): Promise<CryptoKey> {
  const first = credential.getClientExtensionResults().prf?.results?.first
  if (!(first instanceof ArrayBuffer)) throw new PasskeySemCifraError()
  const bytes = new Uint8Array(first)
  try {
    if (bytes.byteLength !== 32) throw new PasskeySemCifraError()
    return await webcrypto.importKek(bytes)
  } finally { bytes.fill(0) }
}

export interface WebAuthnRegistrationInput {
  challenge: Uint8Array<ArrayBuffer>
  relyingPartyId: string
  userId: Uint8Array<ArrayBuffer>
  userName: string
  signal?: AbortSignal
}

export interface WebAuthnAssertionInput {
  challenge: Uint8Array<ArrayBuffer>
  relyingPartyId: string
  credentialId: Uint8Array<ArrayBuffer>
  signal?: AbortSignal
}

export interface WebAuthnRegistrationCredential {
  credentialId: Uint8Array<ArrayBuffer>
  clientDataJson: Uint8Array<ArrayBuffer>
  attestationObject: Uint8Array<ArrayBuffer>
  kek: CryptoKey
}

export interface WebAuthnAssertionCredential {
  credentialId: Uint8Array<ArrayBuffer>
  clientDataJson: Uint8Array<ArrayBuffer>
  authenticatorData: Uint8Array<ArrayBuffer>
  signature: Uint8Array<ArrayBuffer>
  kek: CryptoKey
}

const RELYING_PARTY_NAME = 'Limmiar'

export async function createCredentialWithBrowser(
  input: WebAuthnRegistrationInput,
): Promise<WebAuthnRegistrationCredential> {
  const credential = (await navigator.credentials.create({
    signal: input.signal,
    publicKey: {
      challenge: input.challenge,
      rp: { id: input.relyingPartyId, name: RELYING_PARTY_NAME },
      user: { id: input.userId, name: input.userName, displayName: input.userName },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { userVerification: 'required', residentKey: 'required' },
      extensions: { prf: { eval: { first: PRF_INPUT } } },
    },
  })) as PublicKeyCredential
  const response = credential.response as AuthenticatorAttestationResponse
  const prf = credential.getClientExtensionResults().prf
  if (prf?.results === undefined && prf?.enabled !== true) throw new PasskeySemCifraError()
  const encryptionCredential = prf.results === undefined
    ? await navigator.credentials.get({ signal: input.signal, publicKey: {
      challenge: input.challenge, rpId: input.relyingPartyId,
      allowCredentials: [{ type: 'public-key', id: credential.rawId }],
      userVerification: 'required', extensions: { prf: { eval: { first: PRF_INPUT } } },
    } }) as PublicKeyCredential
    : credential
  const kek = await abrirKek(encryptionCredential)

  return {
    credentialId: new Uint8Array(credential.rawId),
    clientDataJson: new Uint8Array(response.clientDataJSON),
    attestationObject: new Uint8Array(response.attestationObject),
    kek,
  }
}

export async function getCredentialWithBrowser(input: WebAuthnAssertionInput): Promise<WebAuthnAssertionCredential> {
  const credential = (await navigator.credentials.get({
    signal: input.signal,
    publicKey: {
      challenge: input.challenge,
      rpId: input.relyingPartyId,
      allowCredentials: [{ type: 'public-key', id: input.credentialId }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: PRF_INPUT } } },
    },
  })) as PublicKeyCredential
  const response = credential.response as AuthenticatorAssertionResponse

  return {
    credentialId: new Uint8Array(credential.rawId),
    clientDataJson: new Uint8Array(response.clientDataJSON),
    authenticatorData: new Uint8Array(response.authenticatorData),
    signature: new Uint8Array(response.signature),
    kek: await abrirKek(credential),
  }
}
