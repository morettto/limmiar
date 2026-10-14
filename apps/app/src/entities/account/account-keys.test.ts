import { afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from '@limmiar/crypto'
import { createRecoveryEnvelope, deriveAccountKek, deriveAccountKekForTransfer, openRecoveryEnvelope } from './account-keys'
import { deriveEmailPasswordVerifier, deriveEmailSalt } from './password-verifier'
import { deriveRecoveryVerifier } from './recovery-verifier'

vi.mock('./password-verifier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./password-verifier')>()
  return { ...actual, deriveEmailPasswordVerifier: vi.fn(actual.deriveEmailPasswordVerifier) }
})
vi.mock('./recovery-verifier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./recovery-verifier')>()
  return { ...actual, deriveRecoveryVerifier: vi.fn(actual.deriveRecoveryVerifier) }
})

const PASSWORD = 'senha-de-teste-apenas'
const EMAIL = 'pro@example.com'
const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const AAD = new TextEncoder().encode('patient:teste:v1')

const sha256 = (texto: string) => webcrypto.sha256(new TextEncoder().encode(texto))
const todosZero = (bytes: Uint8Array) => bytes.every((byte) => byte === 0)
const derivados = (mock: { mock: { results: { value: unknown }[] } }) => Promise.all(mock.mock.results.map((resultado) => resultado.value as Promise<Uint8Array>))

describe('recuperação da chave clínica', () => {
  afterEach(() => { vi.mocked(deriveEmailPasswordVerifier).mockClear(); vi.mocked(deriveRecoveryVerifier).mockClear(); vi.restoreAllMocks() })

  it('reconstitui para transferência somente a mesma chave da sessão e recusa outra senha', async () => {
    const current = await deriveAccountKek(PASSWORD, EMAIL)
    const raw = await deriveAccountKekForTransfer(PASSWORD, EMAIL, current)
    const adopted = await webcrypto.importKek(raw)
    expect(raw).toEqual(new Uint8Array(32))
    const { wrapped } = await webcrypto.generateWrappedDek(current, AAD)
    await expect(webcrypto.unwrapDek(adopted, wrapped, AAD)).resolves.toBeDefined()
    await expect(deriveAccountKekForTransfer('senha-errada', EMAIL, current)).rejects.toThrow()
    expect(current.extractable).toBe(false)
  }, 15000)
  it('abre o mesmo prontuário apenas com a frase em uma nova sessão', async () => {
    const current = await deriveAccountKek(PASSWORD, EMAIL)
    const { dek, wrapped } = await webcrypto.generateWrappedDek(current, AAD)
    const texto = new TextEncoder().encode('Transcrição somente do paciente')
    const cifra = await webcrypto.encrypt(dek, texto, AAD)
    const envelope = await createRecoveryEnvelope(PASSWORD, EMAIL, ACCOUNT_ID, PHRASE, current)

    const recovered = await openRecoveryEnvelope(PHRASE, EMAIL, ACCOUNT_ID, envelope)
    const reopenedDek = await webcrypto.unwrapDek(recovered, wrapped, AAD)

    expect(Array.from(await webcrypto.decrypt(reopenedDek, cifra, AAD))).toEqual(Array.from(texto))
    expect(envelope).toHaveLength(120)
    expect(recovered.extractable).toBe(false)
    expect(recovered.usages).toEqual(['wrapKey', 'unwrapKey'])
    expect(new TextDecoder().decode(envelope)).not.toContain(PASSWORD)
  }, 15000)

  it('normaliza o email sem trocar a chave nem o contexto autenticado', async () => {
    const current = await deriveAccountKek(PASSWORD, `  ${EMAIL.toUpperCase()}  `)
    const envelope = await createRecoveryEnvelope(PASSWORD, EMAIL, ACCOUNT_ID, PHRASE, current)
    const recovered = await openRecoveryEnvelope(PHRASE, ` ${EMAIL.toUpperCase()} `, ACCOUNT_ID, envelope)
    const { wrapped } = await webcrypto.generateWrappedDek(current, AAD)
    await expect(webcrypto.unwrapDek(recovered, wrapped, AAD)).resolves.toBeDefined()
  }, 15000)

  it('recusa proteger uma chave com senha diferente da sessão atual', async () => {
    const current = await deriveAccountKek(PASSWORD, EMAIL)
    await expect(createRecoveryEnvelope('senha-errada', EMAIL, ACCOUNT_ID, PHRASE, current)).rejects.toThrow()
  }, 15000)

  it('não deixa o verificador enviado ao servidor destrancar o envelope', async () => {
    const current = await deriveAccountKek(PASSWORD, EMAIL)
    const envelope = await createRecoveryEnvelope(PASSWORD, EMAIL, ACCOUNT_ID, PHRASE, current)
    const verifier = await deriveRecoveryVerifier(PHRASE, await deriveEmailSalt(EMAIL))
    const verifierKey = await webcrypto.importKek(new Uint8Array(verifier))
    const aad = new TextEncoder().encode(`limmiar/account-recovery/v1|${ACCOUNT_ID}|dek`)
    await expect(webcrypto.unwrapDek(verifierKey, envelope.slice(0, 60), aad)).rejects.toThrow()
  }, 15000)

  it('recusa frase, conta e email diferentes, cifras truncadas e adulteradas', async () => {
    const current = await deriveAccountKek(PASSWORD, EMAIL)
    const envelope = await createRecoveryEnvelope(PASSWORD, EMAIL, ACCOUNT_ID, PHRASE, current)
    const adulterado = new Uint8Array(envelope)
    adulterado[119] = adulterado[119]! ^ 1
    for (const [phrase, email, accountId, bytes] of [
      ['outra frase', EMAIL, ACCOUNT_ID, envelope],
      [PHRASE, 'outra@example.com', ACCOUNT_ID, envelope],
      [PHRASE, EMAIL, 'outra-conta', envelope],
      [PHRASE, EMAIL, ACCOUNT_ID, envelope.slice(0, 119)],
      [PHRASE, EMAIL, ACCOUNT_ID, adulterado],
    ] as const) {
      await expect(openRecoveryEnvelope(phrase, email, accountId, bytes)).rejects.toThrow()
    }
  }, 15000)

  it('deriva a chave da conta do e-mail em minúsculas e do domínio próprio, não de outra grafia', async () => {
    const current = await deriveAccountKek(PASSWORD, `  ${EMAIL.toUpperCase()}  `)
    const independente = await webcrypto.importKek(new Uint8Array(await deriveEmailPasswordVerifier(PASSWORD, await sha256(`limmiar/account-kek/v1|${EMAIL}`))))
    const { wrapped } = await webcrypto.generateWrappedDek(current, AAD)
    await expect(webcrypto.unwrapDek(independente, wrapped, AAD)).resolves.toBeDefined()
  }, 15000)

  it('o envelope abre com a chave da frase derivada do domínio de recuperação', async () => {
    const current = await deriveAccountKek(PASSWORD, EMAIL)
    const envelope = await createRecoveryEnvelope(PASSWORD, EMAIL, ACCOUNT_ID, PHRASE, current)
    const verificador = await deriveRecoveryVerifier(PHRASE, await sha256(`limmiar/account-recovery-kek/v1|${EMAIL}`))
    const chave = await webcrypto.importKek(new Uint8Array(verificador))
    const aad = new TextEncoder().encode(`limmiar/account-recovery/v1|${ACCOUNT_ID}|dek`)
    await expect(webcrypto.unwrapDek(chave, envelope.slice(0, 60), aad)).resolves.toBeDefined()
  }, 15000)

  it('zera tudo o que derivou da senha e da frase assim que termina', async () => {
    const encrypt = vi.spyOn(webcrypto, 'encrypt')
    const decrypt = vi.spyOn(webcrypto, 'decrypt')
    const current = await deriveAccountKek(PASSWORD, EMAIL)
    expect((await derivados(vi.mocked(deriveEmailPasswordVerifier))).every(todosZero)).toBe(true)

    vi.mocked(deriveEmailPasswordVerifier).mockClear()
    const envelope = await createRecoveryEnvelope(PASSWORD, EMAIL, ACCOUNT_ID, PHRASE, current)
    expect((await derivados(vi.mocked(deriveEmailPasswordVerifier))).every(todosZero)).toBe(true)
    expect((await derivados(vi.mocked(deriveRecoveryVerifier))).every(todosZero)).toBe(true)
    expect(encrypt.mock.calls.at(-1)![1].every((byte) => byte === 0)).toBe(true)
    expect(encrypt.mock.calls.at(-1)![1]).toHaveLength(32)

    vi.mocked(deriveRecoveryVerifier).mockClear()
    await openRecoveryEnvelope(PHRASE, EMAIL, ACCOUNT_ID, envelope)
    expect((await derivados(vi.mocked(deriveRecoveryVerifier))).every(todosZero)).toBe(true)
    const aberto = (await decrypt.mock.results.at(-1)!.value) as Uint8Array
    expect(aberto).toHaveLength(32)
    expect(todosZero(aberto)).toBe(true)
  }, 30000)

  it('recusa um envelope de tamanho errado antes de derivar qualquer chave', async () => {
    const current = await deriveAccountKek(PASSWORD, EMAIL)
    const envelope = await createRecoveryEnvelope(PASSWORD, EMAIL, ACCOUNT_ID, PHRASE, current)
    vi.mocked(deriveRecoveryVerifier).mockClear()
    for (const bytes of [envelope.slice(0, 119), new Uint8Array([...envelope, 0])]) {
      await expect(openRecoveryEnvelope(PHRASE, EMAIL, ACCOUNT_ID, bytes)).rejects.toThrow('Invalid recovery envelope')
    }
    expect(deriveRecoveryVerifier).not.toHaveBeenCalled()
  }, 15000)
})
