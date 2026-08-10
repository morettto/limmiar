export interface WebAuthnRegistrationInput {
  challenge: Uint8Array<ArrayBuffer>
  relyingPartyId: string
  userId: Uint8Array<ArrayBuffer>
  userName: string
}

export interface WebAuthnAssertionInput {
  challenge: Uint8Array<ArrayBuffer>
  relyingPartyId: string
  credentialId: Uint8Array<ArrayBuffer>
}

export interface WebAuthnRegistrationCredential {
  credentialId: Uint8Array<ArrayBuffer>
  clientDataJson: Uint8Array<ArrayBuffer>
  attestationObject: Uint8Array<ArrayBuffer>
}

export interface WebAuthnAssertionCredential {
  credentialId: Uint8Array<ArrayBuffer>
  clientDataJson: Uint8Array<ArrayBuffer>
  authenticatorData: Uint8Array<ArrayBuffer>
  signature: Uint8Array<ArrayBuffer>
}

const RELYING_PARTY_NAME = 'Limmiar'

export async function createCredentialWithBrowser(
  input: WebAuthnRegistrationInput,
): Promise<WebAuthnRegistrationCredential> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: input.challenge,
      rp: { id: input.relyingPartyId, name: RELYING_PARTY_NAME },
      user: { id: input.userId, name: input.userName, displayName: input.userName },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { userVerification: 'required', authenticatorAttachment: 'platform' },
    },
  })) as PublicKeyCredential
  const response = credential.response as AuthenticatorAttestationResponse

  return {
    credentialId: new Uint8Array(credential.rawId),
    clientDataJson: new Uint8Array(response.clientDataJSON),
    attestationObject: new Uint8Array(response.attestationObject),
  }
}

export async function getCredentialWithBrowser(input: WebAuthnAssertionInput): Promise<WebAuthnAssertionCredential> {
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: input.challenge,
      rpId: input.relyingPartyId,
      allowCredentials: [{ type: 'public-key', id: input.credentialId }],
      userVerification: 'required',
    },
  })) as PublicKeyCredential
  const response = credential.response as AuthenticatorAssertionResponse

  return {
    credentialId: new Uint8Array(credential.rawId),
    clientDataJson: new Uint8Array(response.clientDataJSON),
    authenticatorData: new Uint8Array(response.authenticatorData),
    signature: new Uint8Array(response.signature),
  }
}
