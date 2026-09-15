import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { webcrypto, type CryptoKey } from '@limmiar/crypto'
import { API_BASE_URL } from '../playwright.config'
import { registrarPaciente, registrarProfissionalVerificada, contaTestKek, type ContaTeste } from './fixtures/contas'
import { garantirParDeChaves } from '../src/entities/vinculo/par-de-chaves'
import { criarConviteVinculo, resgatarConviteVinculo } from '../src/entities/vinculo/api'
import { decifrarItem } from '../src/entities/partilha/cifra'
import { diaLocal } from '../src/entities/checkin/checkin'

// S11-02, fatia 7: passos 6-8 do Cenário E2E (Specs/S11 Partilha e espelho P6.md). Os passos 1-5
// (par de chaves das duas + vínculo) são preparação, feita via API direto (mesmas funções que
// vinculo-chave-publica.spec.ts exercita pela UI), não repetida aqui pela UI.

test.describe.configure({ mode: 'serial' })

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function partilhaUrl(p: { accountId: string; accessToken: string; kek: Uint8Array; papel: 'paciente' | 'profissional'; agora?: string }): string {
  const search = new URLSearchParams({
    baseUrl: API_BASE_URL,
    accountId: p.accountId,
    accessToken: p.accessToken,
    kek: toBase64(p.kek),
    papel: p.papel,
    agora: p.agora ?? '',
  })
  return `/e2e/partilha?${search.toString()}`
}

let marta: ContaTeste
let ana: ContaTeste
let martaKekRaw: Uint8Array
let anaKekRaw: Uint8Array
let martaPrivateKey: Uint8Array
let anaPublicKey: Uint8Array
let anaContext: BrowserContext
let anaPage: Page
let martaContext: BrowserContext
let martaPage: Page
// Marcador da frase de "hoje", usado para achar o mesmo item nos dois lados sem depender de
// `diaLocal` calculado duas vezes (uma no teste, outra no browser).
let fraseHoje: string
// Marcador do check-in de amanhã, nunca partilhado (revogado antes de gravar) -- fatia 4 prova a
// ausência dele em P6.
let fraseAmanha: string
// patientId do convite do beforeAll: a fatia 4 precisa dele para casar a sessão stubada da
// agenda com o vínculo de Marta/Ana.
let patientId: string

function newActorContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ locale: 'pt-BR' })
}

test.beforeAll(async ({ browser, request }) => {
  ;[marta, ana] = await Promise.all([
    registrarProfissionalVerificada(request, 'marta-partilha'),
    registrarPaciente(request, 'ana-partilha'),
  ])
  martaKekRaw = contaTestKek(41)
  anaKekRaw = contaTestKek(42)
  // importKek zera o array recebido (packages/crypto/src/webcrypto.ts) -- uma cópia entra aqui,
  // não o próprio *KekRaw, que ainda vai para a query string do browser mais abaixo.
  const martaKek: CryptoKey = await webcrypto.importKek(new Uint8Array(martaKekRaw))
  const anaKek: CryptoKey = await webcrypto.importKek(new Uint8Array(anaKekRaw))

  const martaPar = await garantirParDeChaves({ baseUrl: API_BASE_URL, accountId: marta.accountId, accessToken: marta.accessToken, kek: martaKek })
  const anaPar = await garantirParDeChaves({ baseUrl: API_BASE_URL, accountId: ana.accountId, accessToken: ana.accessToken, kek: anaKek })
  martaPrivateKey = martaPar.privateKey
  anaPublicKey = anaPar.publicKey

  patientId = crypto.randomUUID()
  const invite = await criarConviteVinculo(API_BASE_URL, marta.accountId, marta.accessToken, patientId)
  if (!invite.ok) {
    throw new Error(`prep: falha ao criar convite (${invite.code})`)
  }
  const redeemed = await resgatarConviteVinculo(API_BASE_URL, ana.accountId, ana.accessToken, invite.codigo)
  if (!redeemed.ok) {
    throw new Error(`prep: falha ao resgatar convite (${redeemed.code})`)
  }

  anaContext = await newActorContext(browser)
  anaPage = await anaContext.newPage()
  martaContext = await newActorContext(browser)
  martaPage = await martaContext.newPage()
})

test.afterAll(async () => {
  await anaContext.close()
  await martaContext.close()
})

test.describe('S11-02 · Partilha seletiva cifrada de check-ins (paciente → profissional)', () => {
  test('a paciente ativa o compartilhamento e o check-in de hoje sai cifrado para a profissional, e o servidor só vê ciphertext', async () => {
    const preferencesRequestBodies: string[] = []
    anaPage.on('request', (req) => {
      if (req.method() === 'PUT' && req.url().includes('/sharing-preferences')) {
        preferencesRequestBodies.push(req.postData() ?? '')
      }
    })

    await anaPage.goto(partilhaUrl({ accountId: ana.accountId, accessToken: ana.accessToken, kek: anaKekRaw, papel: 'paciente' }))

    const checkbox = anaPage.getByRole('checkbox', { name: 'Compartilhar check-ins com esta profissional' })
    await expect(checkbox).toBeVisible()

    const putSharingPreferences = anaPage.waitForResponse(
      (res) => res.request().method() === 'PUT' && res.url().includes('/sharing-preferences'),
    )
    // .click(), não .check(): o checkbox controlado por React só reflete `checked` depois do
    // PUT resolver, então a verificação embutida de .check() vê "não mudou" cedo demais.
    await checkbox.click()
    const putResponse = await putSharingPreferences
    expect(putResponse.status()).toBe(200)
    await expect(checkbox).toBeChecked()

    // Não usa getByRole('status') puro: PacienteHojePage e PartilhaCheckIns, na mesma página,
    // têm cada um o seu role="status" (lição do S11-04, mesmo comentário em vinculo-chave-publica).
    await expect(
      anaPage.getByText('Os check-ins que você registrar a partir de agora são compartilhados com esta profissional.'),
    ).toBeVisible()

    expect(preferencesRequestBodies).toHaveLength(1)
    const preferencesBody = preferencesRequestBodies[0]!
    expect(preferencesBody).not.toContain(marta.accountId)
    expect(preferencesBody.toLowerCase()).not.toContain('checkin')

    fraseHoje = `frase-hoje-${crypto.randomUUID()}`
    await anaPage.getByRole('group', { name: 'Sono' }).getByRole('radio', { name: '3' }).check()
    await anaPage.getByRole('group', { name: 'Ansiedade' }).getByRole('radio', { name: '2' }).check()
    await anaPage.getByLabel('Uma frase (opcional)').fill(fraseHoje)

    const postSharedItem = anaPage.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/shared-items'),
    )
    await anaPage.getByRole('button', { name: 'Guardar' }).click()
    const sharedItemResponse = await postSharedItem
    expect(sharedItemResponse.status()).toBe(204)

    const sharedItemBody = sharedItemResponse.request().postDataJSON() as { ciphertext: string }
    const ciphertextAsText = Buffer.from(sharedItemBody.ciphertext, 'base64').toString('latin1')
    for (const segredoEmClaro of [fraseHoje, 'checkin', 'sono', 'ansiedade', ana.accountId, marta.accountId]) {
      expect(ciphertextAsText).not.toContain(segredoEmClaro)
    }

    await expect(anaPage.getByText('Guardado', { exact: true })).toBeVisible()
  })

  test('a profissional decifra no dispositivo dela o check-in compartilhado', async () => {
    await martaPage.goto(partilhaUrl({ accountId: marta.accountId, accessToken: marta.accessToken, kek: martaKekRaw, papel: 'profissional' }))

    const itens = martaPage.getByRole('listitem')
    await expect(itens).toHaveCount(7)
    const itemDeHoje = itens.filter({ hasText: fraseHoje })
    await expect(itemDeHoje).toHaveCount(1)
    await expect(itemDeHoje).toContainText('3/2')
  })

  test('a paciente revoga: o check-in de amanhã não é cifrado para a profissional, o de hoje continua visível e a tela diz isso sem prometer apagar', async ({ request }) => {
    const checkbox = anaPage.getByRole('checkbox', { name: 'Compartilhar check-ins com esta profissional' })
    const putSharingPreferences = anaPage.waitForResponse(
      (res) => res.request().method() === 'PUT' && res.url().includes('/sharing-preferences'),
    )
    await checkbox.click()
    const putResponse = await putSharingPreferences
    expect(putResponse.status()).toBe(200)
    await expect(checkbox).not.toBeChecked()

    await expect(
      anaPage.getByText(
        'Compartilhamento de check-ins desativado. O que muda: os check-ins que você registrar a partir de agora não são compartilhados. O que não muda: os check-ins já compartilhados continuam com a profissional, que pode já tê-los lido, e a Limmiar não consegue apagá-los. O vínculo continua ativo.',
      ),
    ).toBeVisible()

    const sharedItemPosts: string[] = []
    anaPage.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/shared-items')) {
        sharedItemPosts.push(req.url())
      }
    })

    const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    await anaPage.goto(
      partilhaUrl({ accountId: ana.accountId, accessToken: ana.accessToken, kek: anaKekRaw, papel: 'paciente', agora: amanha }),
    )
    fraseAmanha = `frase-amanha-${crypto.randomUUID()}`
    await anaPage.getByRole('group', { name: 'Sono' }).getByRole('radio', { name: '4' }).check()
    await anaPage.getByRole('group', { name: 'Ansiedade' }).getByRole('radio', { name: '1' }).check()
    await anaPage.getByLabel('Uma frase (opcional)').fill(fraseAmanha)
    await anaPage.getByRole('button', { name: 'Guardar' }).click()
    await expect(anaPage.getByText('Guardado', { exact: true })).toBeVisible()

    expect(sharedItemPosts).toEqual([])

    const sharedItemsResponse = await request.get(
      `${API_BASE_URL}/accounts/${marta.accountId}/links/${ana.accountId}/shared-items`,
      { headers: { Authorization: `Bearer ${marta.accessToken}` } },
    )
    expect(sharedItemsResponse.ok()).toBe(true)
    const sharedItems = (await sharedItemsResponse.json()) as { sharedAt: string; ciphertext: string }[]
    expect(sharedItems).toHaveLength(1)
    const decrypted = decifrarItem({
      privadaProfissional: martaPrivateKey,
      publicaPaciente: anaPublicKey,
      pacienteAccountId: ana.accountId,
      profissionalAccountId: marta.accountId,
      ciphertext: new Uint8Array(Buffer.from(sharedItems[0]!.ciphertext, 'base64')),
    }) as { tipo: 'checkin'; checkin: { frase: string | null } }
    expect(decrypted.checkin.frase).toBe(fraseHoje)

    const anaLinks = (await (
      await request.get(`${API_BASE_URL}/accounts/${ana.accountId}/links`, { headers: { Authorization: `Bearer ${ana.accessToken}` } })
    ).json()) as { peerPublicKey: string | null }[]
    expect(anaLinks).toHaveLength(1)
    expect(anaLinks[0]!.peerPublicKey).not.toBeNull()

    const martaLinks = (await (
      await request.get(`${API_BASE_URL}/accounts/${marta.accountId}/links`, { headers: { Authorization: `Bearer ${marta.accessToken}` } })
    ).json()) as { peerPublicKey: string | null }[]
    expect(martaLinks).toHaveLength(1)
    expect(martaLinks[0]!.peerPublicKey).not.toBeNull()
  })

  test('a profissional vê em P6 o check-in de hoje que a paciente revogou depois, amanhã como lacuna, a sessão marcada e a adoção só do que foi partilhado', async () => {
    const agoraReal = new Date()
    const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000)

    // Só `agenda/sessions` leva stub (playwright.config.ts:43, sem Postgres nesta suíte);
    // vínculo, chaves e envelopes continuam reais.
    await martaPage.route('**/agenda/sessions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [{ sessionId: crypto.randomUUID(), patientId, startsAt: agoraReal.toISOString(), durationMinutes: 50 }],
        }),
      })
    })

    await martaPage.goto(
      partilhaUrl({
        accountId: marta.accountId,
        accessToken: marta.accessToken,
        kek: martaKekRaw,
        papel: 'profissional',
        agora: amanha.toISOString(),
      }),
    )

    const itens = martaPage.getByRole('listitem')
    await expect(itens).toHaveCount(7)

    const itemDeHoje = itens.filter({ hasText: diaLocal(agoraReal) })
    await expect(itemDeHoje).toContainText(fraseHoje)
    await expect(itemDeHoje).toContainText('Sessão às')

    const itemDeAmanha = itens.filter({ hasText: diaLocal(amanha) })
    await expect(itemDeAmanha).toContainText('sem check-in')

    await expect(martaPage.getByText(fraseAmanha)).toHaveCount(0)
    await expect(martaPage.getByText('Check-in compartilhado em 1 de 7 dias')).toBeVisible()
  })

  test('a paciente desvincula e a profissional continua a ver em P6 o check-in de hoje que foi decifrado antes, sem nada posterior à revogação', async ({ request }) => {
    const desvincularResponse = await request.delete(`${API_BASE_URL}/accounts/${ana.accountId}/links/${marta.accountId}`, {
      headers: { Authorization: `Bearer ${ana.accessToken}` },
    })
    expect(desvincularResponse.ok()).toBe(true)

    // Invariante do humano: GET links e GET shared-items mantêm o 404 depois de desvincular.
    const linksAfterUnlink = await request.get(`${API_BASE_URL}/accounts/${marta.accountId}/links`, {
      headers: { Authorization: `Bearer ${marta.accessToken}` },
    })
    expect(await linksAfterUnlink.json()).toEqual([])

    const sharedItemsAfterUnlink = await request.get(
      `${API_BASE_URL}/accounts/${marta.accountId}/links/${ana.accountId}/shared-items`,
      { headers: { Authorization: `Bearer ${marta.accessToken}` } },
    )
    expect(sharedItemsAfterUnlink.status()).toBe(404)

    const agoraReal = new Date()
    await martaPage.route('**/agenda/sessions*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [] }) })
    })

    await martaPage.goto(
      partilhaUrl({ accountId: marta.accountId, accessToken: marta.accessToken, kek: martaKekRaw, papel: 'profissional', agora: agoraReal.toISOString() }),
    )

    const itens = martaPage.getByRole('listitem')
    await expect(itens).toHaveCount(7)
    const itemDeHoje = itens.filter({ hasText: diaLocal(agoraReal) })
    await expect(itemDeHoje).toContainText(fraseHoje)
    await expect(martaPage.getByText(fraseAmanha)).toHaveCount(0)
    await expect(martaPage.getByText('Check-in compartilhado em 1 de 7 dias')).toBeVisible()
  })
})
