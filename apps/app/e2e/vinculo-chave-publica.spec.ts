import { test, expect, type APIRequestContext } from '@playwright/test'
import { webcrypto, getPublicKey } from '@limmiar/crypto'
import { API_BASE_URL } from '../playwright.config'
import { contaTestKek, registrarPaciente, registrarProfissionalVerificada, type ContaPaciente, type ContaProfissional } from './fixtures/contas'

// S11-04: um teste por passo do Cenário E2E (Specs/S11 Partilha e espelho P6.md), com o nome
// exato de cada "Teste:". Os passos 6-8 (partilha/revogação) são do S11-02. O par de chaves
// nasce como em par-de-chaves.ts: GET 404 -> gera, sela, PUT; GET 200 -> decifra o existente.

test.describe.configure({ mode: 'serial' })

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function keyPairAad(accountId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`limmiar/chave-x25519/v1|${accountId}`)
}

/** Decrypts a PUT/GET .../key-pair envelope with the given raw KEK -- Node's crypto.subtle (available since Node 20) runs the same @limmiar/crypto webcrypto primitives par-de-chaves.ts uses in the browser. */
async function decifrarEnvelope(
  accountId: string,
  rawKek: Uint8Array,
  envelope: { wrappedDek: string; sealedPrivateKey: string },
): Promise<Uint8Array> {
  const kek = await webcrypto.importKek(new Uint8Array(rawKek))
  const aad = keyPairAad(accountId)
  const dek = await webcrypto.unwrapDek(kek, new Uint8Array(Buffer.from(envelope.wrappedDek, 'base64')), aad)
  return webcrypto.decrypt(dek, new Uint8Array(Buffer.from(envelope.sealedPrivateKey, 'base64')), aad)
}

function vinculoUrl(params: { accountId: string; accessToken: string; kek: Uint8Array; papel: 'Professional' | 'Patient'; patientId: string }): string {
  const search = new URLSearchParams({
    baseUrl: API_BASE_URL,
    accountId: params.accountId,
    accessToken: params.accessToken,
    kek: toBase64(params.kek),
    papel: params.papel,
    patientId: params.patientId,
  })
  return `/e2e/vinculo?${search.toString()}`
}

interface KeyPairWire {
  publicKey: string
  wrappedDek: string
  sealedPrivateKey: string
}

async function getKeyPair(request: APIRequestContext, accountId: string, accessToken: string) {
  return request.get(`${API_BASE_URL}/accounts/${accountId}/key-pair`, { headers: { Authorization: `Bearer ${accessToken}` } })
}

async function getLinks(request: APIRequestContext, accountId: string, accessToken: string) {
  return request.get(`${API_BASE_URL}/accounts/${accountId}/links`, { headers: { Authorization: `Bearer ${accessToken}` } })
}

// Estado partilhado entre os passos, na mesma ordem narrativa do cenário -- mode: 'serial'
// garante que corre por esta ordem, no mesmo worker.
let marta: ContaProfissional
let rui: ContaProfissional
let ana: ContaPaciente
let beatriz: ContaPaciente
let martaKek: Uint8Array
let anaKek: Uint8Array
let patientIdAna: string
let martaPublicKey: Uint8Array
let anaPublicKey: Uint8Array
let codigoConviteAna: string

test.beforeAll(async ({ request }) => {
  ;[marta, rui] = await Promise.all([
    registrarProfissionalVerificada(request, 'marta'),
    registrarProfissionalVerificada(request, 'rui'),
  ])
  ;[ana, beatriz] = await Promise.all([registrarPaciente(request, 'ana'), registrarPaciente(request, 'beatriz')])
  martaKek = contaTestKek(1)
  anaKek = contaTestKek(2)
  patientIdAna = crypto.randomUUID()
})

test.describe('S11-04 · Vínculo profissional-paciente + chave pública da conta', () => {
  test.use({ locale: 'pt-BR' })

  test('a profissional publica a chave pública ao destrancar e a privada só sai selada', async ({ page }) => {
    const capturedBodies: string[] = []
    page.on('request', (req) => {
      const data = req.postData()
      if (data) capturedBodies.push(data)
    })
    page.on('response', (res) => {
      void res
        .text()
        .then((body) => {
          if (body) capturedBodies.push(body)
        })
        .catch(() => {})
    })

    const putRequest = page.waitForRequest((req) => req.method() === 'PUT' && req.url().includes('/key-pair'))
    await page.goto(vinculoUrl({ accountId: marta.accountId, accessToken: marta.accessToken, kek: martaKek, papel: 'Professional', patientId: patientIdAna }))
    const put = await putRequest
    const publishedBody = put.postDataJSON() as KeyPairWire
    expect(publishedBody.publicKey).toHaveLength(44) // base64 of 32 bytes

    const privateKey = await decifrarEnvelope(marta.accountId, martaKek, publishedBody)
    martaPublicKey = new Uint8Array(Buffer.from(publishedBody.publicKey, 'base64'))
    expect(getPublicKey(privateKey)).toEqual(martaPublicKey)

    await page.waitForTimeout(300) // deixa qualquer corpo em trânsito ser capturado
    const privateKeyBase64 = toBase64(privateKey)
    for (const body of capturedBodies) {
      expect(body, 'a privada nunca aparece em claro em nenhum pedido/resposta').not.toContain(privateKeyBase64)
    }

    let putAfterReload = 0
    page.on('request', (req) => {
      if (req.method() === 'PUT' && req.url().includes('/key-pair')) putAfterReload++
    })
    const getAfterReload = page.waitForResponse((res) => res.request().method() === 'GET' && res.url().includes('/key-pair'))
    await page.reload()
    const reloadedGet = await getAfterReload
    expect(reloadedGet.status()).toBe(200)
    await page.waitForTimeout(300)
    expect(putAfterReload, 'reload deve ler o par existente, não publicar outro').toBe(0)
  })

  test('sem vínculo, nenhuma das duas vê a chave pública da outra', async ({ request }) => {
    const links = await getLinks(request, ana.accountId, ana.accessToken)
    expect(links.ok()).toBe(true)
    expect(await links.json()).toEqual([])

    const martaKeyPairViaAna = await getKeyPair(request, marta.accountId, ana.accessToken)
    expect(martaKeyPairViaAna.status()).toBe(403)
  })

  test('a profissional gera um código de vínculo para o registo da paciente', async ({ page }) => {
    await page.goto(vinculoUrl({ accountId: marta.accountId, accessToken: marta.accessToken, kek: martaKek, papel: 'Professional', patientId: patientIdAna }))
    await page.getByRole('button', { name: 'Gerar código de vínculo' }).click()

    // Não usa getByRole('status') puro: DesvincularVinculo também renderiza role="status" na
    // mesma página ("Nenhum vínculo."), então dois elementos disputariam o mesmo seletor.
    const codigoStatus = page.getByText(/Código de vínculo: /)
    await expect(codigoStatus).toBeVisible()
    const status = await codigoStatus.textContent()
    expect(status).toMatch(/Código de vínculo: [A-Z0-9]{12}\./)
    const match = status!.match(/Código de vínculo: ([A-Z0-9]{12})\./)
    expect(match).not.toBeNull()
    codigoConviteAna = match![1]!
  })

  test('a paciente resgata o código, publica a sua chave e fica vinculada', async ({ page }) => {
    const putRequest = page.waitForRequest((req) => req.method() === 'PUT' && req.url().includes('/key-pair'))
    await page.goto(vinculoUrl({ accountId: ana.accountId, accessToken: ana.accessToken, kek: anaKek, papel: 'Patient', patientId: '' }))
    const put = await putRequest
    const publishedBody = put.postDataJSON() as KeyPairWire
    anaPublicKey = new Uint8Array(Buffer.from(publishedBody.publicKey, 'base64'))

    await page.getByLabel('Código de vínculo').fill(codigoConviteAna)
    await page.getByRole('button', { name: 'Vincular' }).click()

    // Idem: DesvincularVinculo também tem role="status" nesta página.
    await expect(page.getByText('Vinculada.')).toBeVisible()
  })

  test('com vínculo, cada uma recebe a chave pública da outra na lista de vínculos', async ({ request }) => {
    const anaLinksResponse = await getLinks(request, ana.accountId, ana.accessToken)
    expect(anaLinksResponse.ok()).toBe(true)
    const anaLinks = (await anaLinksResponse.json()) as { professionalAccountId: string; patientAccountId: string; patientId: string; peerPublicKey: string }[]
    expect(anaLinks).toHaveLength(1)
    expect(anaLinks[0]!.patientId).toBe(patientIdAna)
    expect(new Uint8Array(Buffer.from(anaLinks[0]!.peerPublicKey, 'base64'))).toEqual(martaPublicKey)

    const martaLinksResponse = await getLinks(request, marta.accountId, marta.accessToken)
    expect(martaLinksResponse.ok()).toBe(true)
    const martaLinks = (await martaLinksResponse.json()) as { professionalAccountId: string; patientAccountId: string; patientId: string; peerPublicKey: string }[]
    expect(martaLinks).toHaveLength(1)
    expect(martaLinks[0]!.patientId).toBe(patientIdAna)
    expect(new Uint8Array(Buffer.from(martaLinks[0]!.peerPublicKey, 'base64'))).toEqual(anaPublicKey)
  })

  test('um código já usado não vincula outra paciente', async ({ page, request }) => {
    await page.goto(vinculoUrl({ accountId: beatriz.accountId, accessToken: beatriz.accessToken, kek: contaTestKek(3), papel: 'Patient', patientId: '' }))
    await page.getByLabel('Código de vínculo').fill(codigoConviteAna)
    await page.getByRole('button', { name: 'Vincular' }).click()

    await expect(page.getByRole('alert')).toHaveText('Código inválido ou expirado.')

    const beatrizLinks = await getLinks(request, beatriz.accountId, beatriz.accessToken)
    expect(await beatrizLinks.json()).toEqual([])
  })

  test('um código inexistente devolve 404 sem criar vínculo', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/accounts/${beatriz.accountId}/links`, {
      headers: { Authorization: `Bearer ${beatriz.accessToken}` },
      data: { code: 'INVENTADO000' },
    })
    expect(response.status()).toBe(404)
    const problem = (await response.json()) as { code: string }
    expect(problem.code).toBe('link.invite_not_found')

    const beatrizLinks = await getLinks(request, beatriz.accountId, beatriz.accessToken)
    expect(await beatrizLinks.json()).toEqual([])
  })

  test('outra profissional não vê a chave da paciente, porque não há equipa', async ({ request }) => {
    const ruiLinks = await getLinks(request, rui.accountId, rui.accessToken)
    expect(await ruiLinks.json()).toEqual([])

    const anaKeyPairViaRui = await getKeyPair(request, ana.accountId, rui.accessToken)
    expect(anaKeyPairViaRui.status()).toBe(403)

    const ruiOwnLinks = await getLinks(request, rui.accountId, rui.accessToken)
    expect(ruiOwnLinks.status()).toBe(200)
  })

  test('um token de outra conta nas rotas de vínculo e de chave dá 403', async ({ request }) => {
    const inviteViaAna = await request.post(`${API_BASE_URL}/accounts/${marta.accountId}/patients/${crypto.randomUUID()}/link-invites`, {
      headers: { Authorization: `Bearer ${ana.accessToken}` },
    })
    expect(inviteViaAna.status()).toBe(403)

    const putViaAna = await request.put(`${API_BASE_URL}/accounts/${marta.accountId}/key-pair`, {
      headers: { Authorization: `Bearer ${ana.accessToken}` },
      data: { publicKey: toBase64(new Uint8Array(32).fill(9)), wrappedDek: toBase64(new Uint8Array(44)), sealedPrivateKey: toBase64(new Uint8Array(60)) },
    })
    expect(putViaAna.status()).toBe(403)

    const martaKeyPairAfter = await getKeyPair(request, marta.accountId, marta.accessToken)
    const martaKeyPairBody = (await martaKeyPairAfter.json()) as KeyPairWire
    expect(new Uint8Array(Buffer.from(martaKeyPairBody.publicKey, 'base64'))).toEqual(martaPublicKey)
  })

  test('sem autenticação, as rotas de vínculo e de chave dão 401', async ({ request }) => {
    const semAuth = [
      () => request.post(`${API_BASE_URL}/accounts/${marta.accountId}/patients/${crypto.randomUUID()}/link-invites`),
      () => request.post(`${API_BASE_URL}/accounts/${ana.accountId}/links`, { data: { code: 'ABCD1234EFGH' } }),
      () => request.get(`${API_BASE_URL}/accounts/${ana.accountId}/links`),
      () => request.delete(`${API_BASE_URL}/accounts/${ana.accountId}/links/${marta.accountId}`),
      () => request.put(`${API_BASE_URL}/accounts/${marta.accountId}/key-pair`, { data: { publicKey: '', wrappedDek: '', sealedPrivateKey: '' } }),
      () => request.get(`${API_BASE_URL}/accounts/${marta.accountId}/key-pair`),
    ]
    for (const chamada of semAuth) {
      const response = await chamada()
      expect(response.status()).toBe(401)
    }
  })

  test('a paciente desvincula e nenhuma das duas volta a ver a chave pública da outra', async ({ page, request }) => {
    await page.goto(vinculoUrl({ accountId: ana.accountId, accessToken: ana.accessToken, kek: anaKek, papel: 'Patient', patientId: '' }))
    await page.getByRole('button', { name: /Desvincular/ }).click()

    await expect(page.getByRole('status')).toHaveText('Nenhum vínculo.')

    expect(await (await getLinks(request, ana.accountId, ana.accessToken)).json()).toEqual([])
    expect(await (await getLinks(request, marta.accountId, marta.accessToken)).json()).toEqual([])
  })

  test('a profissional desvincula do lado dela e repetir dá 404', async ({ request }) => {
    const inviteResponse = await request.post(`${API_BASE_URL}/accounts/${marta.accountId}/patients/${crypto.randomUUID()}/link-invites`, {
      headers: { Authorization: `Bearer ${marta.accessToken}` },
    })
    const { code } = (await inviteResponse.json()) as { code: string }
    const redeemResponse = await request.post(`${API_BASE_URL}/accounts/${beatriz.accountId}/links`, {
      headers: { Authorization: `Bearer ${beatriz.accessToken}` },
      data: { code },
    })
    expect(redeemResponse.ok()).toBe(true)

    const firstUnlink = await request.delete(`${API_BASE_URL}/accounts/${marta.accountId}/links/${beatriz.accountId}`, {
      headers: { Authorization: `Bearer ${marta.accessToken}` },
    })
    expect(firstUnlink.status()).toBe(204)

    const secondUnlink = await request.delete(`${API_BASE_URL}/accounts/${marta.accountId}/links/${beatriz.accountId}`, {
      headers: { Authorization: `Bearer ${marta.accessToken}` },
    })
    expect(secondUnlink.status()).toBe(404)

    const unlinkByOutsider = await request.delete(`${API_BASE_URL}/accounts/${marta.accountId}/links/${beatriz.accountId}`, {
      headers: { Authorization: `Bearer ${rui.accessToken}` },
    })
    expect(unlinkByOutsider.status()).toBe(403)
  })
})
