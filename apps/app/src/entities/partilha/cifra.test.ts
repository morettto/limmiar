import { decrypt, deriveChannelKey, generateKeyPair, getSharedSecret } from '@limmiar/crypto'
import { describe, expect, it } from 'vitest'
import { cifrarItem, decifrarItem } from './cifra'

const PACIENTE_ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const PROFISSIONAL_ACCOUNT_ID = '22222222-2222-2222-2222-222222222222'
const OUTRA_PROFISSIONAL_ACCOUNT_ID = '33333333-3333-3333-3333-333333333333'

describe('cifrarItem/decifrarItem', () => {
  it('a profissional decifra exatamente o item que a paciente cifrou para ela', () => {
    const paciente = generateKeyPair()
    const profissional = generateKeyPair()
    const item = { tipo: 'checkin' as const, checkin: { dia: '2026-09-14', sono: 3 as const, ansiedade: 2 as const, frase: null } }

    const ciphertext = cifrarItem({
      privadaPaciente: paciente.privateKey,
      publicaProfissional: profissional.publicKey,
      pacienteAccountId: PACIENTE_ACCOUNT_ID,
      profissionalAccountId: PROFISSIONAL_ACCOUNT_ID,
      item,
    })

    const decifrado = decifrarItem({
      privadaProfissional: profissional.privateKey,
      publicaPaciente: paciente.publicKey,
      pacienteAccountId: PACIENTE_ACCOUNT_ID,
      profissionalAccountId: PROFISSIONAL_ACCOUNT_ID,
      ciphertext,
    })

    expect(decifrado).toEqual(item)
  })

  it('uma terceira conta não consegue decifrar o envelope', () => {
    const paciente = generateKeyPair()
    const profissional = generateKeyPair()
    const terceira = generateKeyPair()
    const item = { tipo: 'checkin' as const, checkin: { dia: '2026-09-14', sono: 3 as const, ansiedade: 2 as const, frase: null } }

    const ciphertext = cifrarItem({
      privadaPaciente: paciente.privateKey,
      publicaProfissional: profissional.publicKey,
      pacienteAccountId: PACIENTE_ACCOUNT_ID,
      profissionalAccountId: PROFISSIONAL_ACCOUNT_ID,
      item,
    })

    expect(() =>
      decifrarItem({
        privadaProfissional: terceira.privateKey,
        publicaPaciente: paciente.publicKey,
        pacienteAccountId: PACIENTE_ACCOUNT_ID,
        profissionalAccountId: PROFISSIONAL_ACCOUNT_ID,
        ciphertext,
      }),
    ).toThrow()
  })

  it('a AAD trocada (outro id de profissional) invalida o envelope mesmo com as chaves certas', () => {
    const paciente = generateKeyPair()
    const profissional = generateKeyPair()
    const item = { tipo: 'checkin' as const, checkin: { dia: '2026-09-14', sono: 3 as const, ansiedade: 2 as const, frase: null } }

    const ciphertext = cifrarItem({
      privadaPaciente: paciente.privateKey,
      publicaProfissional: profissional.publicKey,
      pacienteAccountId: PACIENTE_ACCOUNT_ID,
      profissionalAccountId: PROFISSIONAL_ACCOUNT_ID,
      item,
    })

    expect(() =>
      decifrarItem({
        privadaProfissional: profissional.privateKey,
        publicaPaciente: paciente.publicKey,
        pacienteAccountId: PACIENTE_ACCOUNT_ID,
        profissionalAccountId: OUTRA_PROFISSIONAL_ACCOUNT_ID,
        ciphertext,
      }),
    ).toThrow()
  })

  it('usa o salt/AAD `limmiar/partilha/v1|<paciente>|<profissional>`, não um valor arbitrário', () => {
    const paciente = generateKeyPair()
    const profissional = generateKeyPair()
    const item = { tipo: 'checkin' as const, checkin: { dia: '2026-09-14', sono: 3 as const, ansiedade: 2 as const, frase: null } }

    const ciphertext = cifrarItem({
      privadaPaciente: paciente.privateKey,
      publicaProfissional: profissional.publicKey,
      pacienteAccountId: PACIENTE_ACCOUNT_ID,
      profissionalAccountId: PROFISSIONAL_ACCOUNT_ID,
      item,
    })

    const saltEsperado = new TextEncoder().encode(`limmiar/partilha/v1|${PACIENTE_ACCOUNT_ID}|${PROFISSIONAL_ACCOUNT_ID}`)
    const sharedSecret = getSharedSecret(profissional.privateKey, paciente.publicKey)
    const key = deriveChannelKey(sharedSecret, saltEsperado)
    const plaintext = decrypt(key, ciphertext, saltEsperado)

    expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual(item)
  })

  it('recusa um item decifrado que não seja um check-in', () => {
    const paciente = generateKeyPair()
    const profissional = generateKeyPair()
    const ciphertext = cifrarItem({
      privadaPaciente: paciente.privateKey,
      publicaProfissional: profissional.publicKey,
      pacienteAccountId: PACIENTE_ACCOUNT_ID,
      profissionalAccountId: PROFISSIONAL_ACCOUNT_ID,
      item: { tipo: 'outro', checkin: {} } as never,
    })

    expect(() => decifrarItem({
      privadaProfissional: profissional.privateKey,
      publicaPaciente: paciente.publicKey,
      pacienteAccountId: PACIENTE_ACCOUNT_ID,
      profissionalAccountId: PROFISSIONAL_ACCOUNT_ID,
      ciphertext,
    })).toThrow('Envelope partilhado inválido')
  })
})
