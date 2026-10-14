import { afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from '@limmiar/crypto'
import { createCredentialWithBrowser, getCredentialWithBrowser, PasskeySemCifraError } from './webauthn'

function stubCredentials(method: 'create' | 'get', implementation: (options: unknown) => Promise<unknown>) {
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { [method]: vi.fn(implementation) },
  })
}

describe('webauthn', () => {
  const registration = { challenge: new Uint8Array([1]), relyingPartyId: 'localhost', userId: new Uint8Array([2]), userName: 'opaque-id' }
  const assertion = { challenge: new Uint8Array([1]), relyingPartyId: 'localhost', credentialId: new Uint8Array([2]) }
  function credential(extensions: AuthenticationExtensionsClientOutputs) {
    return { rawId: new Uint8Array([2]).buffer, getClientExtensionResults: () => extensions,
      response: { clientDataJSON: new ArrayBuffer(1), attestationObject: new ArrayBuffer(1), authenticatorData: new ArrayBuffer(1), signature: new ArrayBuffer(1) } }
  }
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'credentials')
  })

  it.each([{}, { prf: {} }, { prf: { enabled: false } }])('recusa cadastro sem suporte a ciframento: %j', async (extensions) => {
    stubCredentials('create', async () => credential(extensions))
    await expect(createCredentialWithBrowser(registration)).rejects.toBeInstanceOf(PasskeySemCifraError)
  })

  it('obtém a PRF numa asserção quando o cadastro apenas habilita o recurso', async () => {
    const prf = new Uint8Array(32).fill(11)
    const get = vi.fn(async () => credential({ prf: { results: { first: prf.buffer } } }))
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
      create: vi.fn(async () => credential({ prf: { enabled: true } })), get,
    } })
    const controller = new AbortController()
    const result = await createCredentialWithBrowser({ ...registration, signal: controller.signal })
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal, publicKey: expect.objectContaining({
      allowCredentials: [{ type: 'public-key', id: new Uint8Array([2]).buffer }], userVerification: 'required',
    }) }))
    expect(result.kek.extractable).toBe(false)
    expect(prf).toEqual(new Uint8Array(32))
  })

  it.each([{}, { prf: {} }, { prf: { results: {} } }])('recusa asserção sem segredo PRF: %j', async (extensions) => {
    stubCredentials('get', async () => credential(extensions as AuthenticationExtensionsClientOutputs))
    await expect(getCredentialWithBrowser(assertion)).rejects.toBeInstanceOf(PasskeySemCifraError)
  })

  it('apaga uma PRF de tamanho inválido mesmo ao recusar a chave', async () => {
    const prf = new Uint8Array(31).fill(11)
    stubCredentials('get', async () => credential({ prf: { results: { first: prf.buffer } } }))
    await expect(getCredentialWithBrowser(assertion)).rejects.toBeInstanceOf(PasskeySemCifraError)
    expect(prf).toEqual(new Uint8Array(31))
  })

  it('a mesma passkey reabre o envelope e outra passkey não consegue abrir os dados', async () => {
    stubCredentials('create', async () => credential({ prf: { results: { first: new Uint8Array(32).fill(11).buffer } } }))
    const created = await createCredentialWithBrowser(registration)
    const aad = new TextEncoder().encode('opaque-id')
    const { dek, wrapped } = await webcrypto.generateWrappedDek(created.kek, aad)
    const message = new TextEncoder().encode('check-in privado')
    const ciphertext = await webcrypto.encrypt(dek, message, aad)
    stubCredentials('get', async () => credential({ prf: { results: { first: new Uint8Array(32).fill(11).buffer } } }))
    const reopened = await getCredentialWithBrowser(assertion)
    const recovered = await webcrypto.unwrapDek(reopened.kek, wrapped, aad)
    expect(new TextDecoder().decode(await webcrypto.decrypt(recovered, ciphertext, aad))).toBe('check-in privado')
    stubCredentials('get', async () => credential({ prf: { results: { first: new Uint8Array(32).fill(12).buffer } } }))
    const stranger = await getCredentialWithBrowser(assertion)
    await expect(webcrypto.unwrapDek(stranger.kek, wrapped, aad)).rejects.toThrow()
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
        getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(7).buffer } } }),
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
        authenticatorSelection: { userVerification: 'required', residentKey: 'required' },
        extensions: { prf: { eval: { first: new TextEncoder().encode('limmiar/patient-kek/prf/v1') } } },
      },
    })
    expect(result).toEqual({
      credentialId: new Uint8Array(rawId),
      clientDataJson: new Uint8Array(clientDataJSON),
      attestationObject: new Uint8Array(attestationObject),
      kek: expect.objectContaining({ type: 'secret', extractable: false }),
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
        getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(7).buffer } } }),
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
        extensions: { prf: { eval: { first: new TextEncoder().encode('limmiar/patient-kek/prf/v1') } } },
      },
    })
    expect(result).toEqual({
      credentialId: new Uint8Array(rawId),
      clientDataJson: new Uint8Array(clientDataJSON),
      authenticatorData: new Uint8Array(authenticatorData),
      signature: new Uint8Array(signature),
      kek: expect.objectContaining({ type: 'secret', extractable: false }),
    })
  })
})
