import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCredentialWithBrowser, getCredentialWithBrowser } from './webauthn'

function stubCredentials(method: 'create' | 'get', implementation: (options: unknown) => Promise<unknown>) {
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { [method]: vi.fn(implementation) },
  })
}

describe('webauthn', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'credentials')
  })

  it('createCredentialWithBrowser calls navigator.credentials.create with the registration options and maps the response', async () => {
    const challenge = new Uint8Array([1, 2, 3])
    const userId = new Uint8Array([9, 9])
    const rawId = new Uint8Array([4, 5]).buffer
    const clientDataJSON = new Uint8Array([6, 7]).buffer
    const attestationObject = new Uint8Array([8]).buffer
    let capturedOptions: unknown

    stubCredentials('create', (options) => {
      capturedOptions = options
      return Promise.resolve({
        rawId,
        response: { clientDataJSON, attestationObject },
      })
    })

    const result = await createCredentialWithBrowser({
      challenge,
      relyingPartyId: 'limmiar.test',
      userId,
      userName: 'someone@example.com',
    })

    expect(capturedOptions).toEqual({
      publicKey: {
        challenge,
        rp: { id: 'limmiar.test', name: 'Limmiar' },
        user: { id: userId, name: 'someone@example.com', displayName: 'someone@example.com' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { userVerification: 'required', authenticatorAttachment: 'platform' },
      },
    })
    expect(result).toEqual({
      credentialId: new Uint8Array(rawId),
      clientDataJson: new Uint8Array(clientDataJSON),
      attestationObject: new Uint8Array(attestationObject),
    })
  })

  it('getCredentialWithBrowser calls navigator.credentials.get with the assertion options and maps the response', async () => {
    const challenge = new Uint8Array([10, 11])
    const credentialId = new Uint8Array([12, 13])
    const rawId = new Uint8Array([14]).buffer
    const clientDataJSON = new Uint8Array([15]).buffer
    const authenticatorData = new Uint8Array([16]).buffer
    const signature = new Uint8Array([17, 18]).buffer
    let capturedOptions: unknown

    stubCredentials('get', (options) => {
      capturedOptions = options
      return Promise.resolve({
        rawId,
        response: { clientDataJSON, authenticatorData, signature },
      })
    })

    const result = await getCredentialWithBrowser({
      challenge,
      relyingPartyId: 'limmiar.test',
      credentialId,
    })

    expect(capturedOptions).toEqual({
      publicKey: {
        challenge,
        rpId: 'limmiar.test',
        allowCredentials: [{ type: 'public-key', id: credentialId }],
        userVerification: 'required',
      },
    })
    expect(result).toEqual({
      credentialId: new Uint8Array(rawId),
      clientDataJson: new Uint8Array(clientDataJSON),
      authenticatorData: new Uint8Array(authenticatorData),
      signature: new Uint8Array(signature),
    })
  })
})
