import { test, expect, type Browser, type Page, type BrowserContext, type APIRequestContext } from '@playwright/test'
import { unwrapDek, wrapDek } from '@limmiar/crypto'
import { API_BASE_URL } from '../playwright.config'

// S02-04 fatia 7: dois `browser.newContext()` fazem de dois dispositivos físicos, contra o relay
// real (a API deste repo como webServer). Exercita o protocolo de pareamento: cada teste regista-se
// por POST /auth/register e usa uma KEK fixa, nunca derivada de password.

/**
 * A fixed, known, non-zero 32-byte KEK, deliberately not all-zero so a bug that zero-fills a
 * buffer instead of copying the KEK cannot silently pass the "adopts a working KEK" test.
 */
const TEST_KEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 11) % 256)

/**
 * `browser.newContext()` picks up the host's locale, which ADR-S00.5-05's boot order then resolves
 * — possibly to a locale with no compiled catalog. Pinning pt-BR (the source locale) keeps this
 * spec's UI-text assertions independent of the host machine.
 */
function newDeviceContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ locale: 'pt-BR' })
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'))
}

/** POST /auth/register with a fresh Patient account -- Patient never needs TOTP enrollment (ADR-S02-03/S02-04), so this one call alone returns a real access token. */
async function registerPatientAccount(
  request: APIRequestContext,
): Promise<{ accountId: string; accessToken: string }> {
  const email = `device-pairing-e2e-${crypto.randomUUID()}@example.com`
  const response = await request.post(`${API_BASE_URL}/auth/register`, {
    data: {
      email,
      // 32 zero bytes, base64 -- shape-valid (AccountService.PasswordVerifierLength), not a
      // real Argon2id output. Nothing in this spec logs in again with it, so its exact value
      // is irrelevant.
      passwordVerifier: toBase64(new Uint8Array(32)),
      role: 'Patient',
    },
  })
  expect(response.ok(), `POST /auth/register failed: ${response.status()} ${await response.text()}`).toBe(true)
  const body = (await response.json()) as { id: string; accessToken: string | null }
  expect(body.accessToken, 'Patient registration must return a session immediately (NotApplicable 2FA)').not.toBeNull()
  return { accountId: body.id, accessToken: body.accessToken! }
}

async function gotoPairPrimary(
  page: Page,
  params: { accountId: string; accessToken: string; kek?: Uint8Array },
): Promise<void> {
  const search = new URLSearchParams({
    baseUrl: API_BASE_URL,
    accountId: params.accountId,
    accessToken: params.accessToken,
    kek: toBase64(params.kek ?? TEST_KEK),
  })
  await page.goto(`/devices/pair-primary?${search.toString()}`)
}

/** Reads PairingQr.tsx's `data-pairing-payload` attribute -- the raw text encoded into the QR image (see that file's own doc comment on why this is the reliable way to recover it, instead of decoding rendered pixels). */
async function readQrPayload(page: Page): Promise<string> {
  const img = page.locator('img[data-pairing-payload]')
  await expect(img).toBeVisible()
  const payload = await img.getAttribute('data-pairing-payload')
  expect(payload).not.toBeNull()
  return payload!
}

/**
 * Navigates to the pair-new test route with `decode` wired to resolve with `qrPayload` (a stand-in
 * for the camera scan — see PairingScan.tsx). `onKekAdopted` is relayed back to this Node process
 * via `page.exposeFunction`, captured into the returned `kekAdopted` promise.
 */
async function gotoPairNew(
  context: BrowserContext,
  page: Page,
  qrPayload: string,
): Promise<{ kekAdopted: Promise<Uint8Array> }> {
  let resolveKek!: (kek: Uint8Array) => void
  const kekAdopted = new Promise<Uint8Array>((resolve) => {
    resolveKek = resolve
  })

  await context.exposeFunction('__e2eDecodeQr', () => qrPayload)
  await context.exposeFunction('__e2eKekAdopted', (kekBase64: string) => {
    resolveKek(fromBase64(kekBase64))
  })

  await page.goto(`/devices/pair-new?${new URLSearchParams({ baseUrl: API_BASE_URL }).toString()}`)

  return { kekAdopted }
}

test.describe('device pairing by QR (S02-04)', () => {
  // Serial, not the file's default `fullyParallel`: every test shares one API process whose pairing
  // TTL is 8s so "expired QR" can observe a real expiry. One test at a time keeps that budget from
  // being squeezed by unrelated parallel work.
  test.describe.configure({ mode: 'serial' })

  test('expired QR is rejected', async ({ request, browser }) => {
    const { accountId, accessToken } = await registerPatientAccount(request)

    const primaryContext = await newDeviceContext(browser)
    const primaryPage = await primaryContext.newPage()
    await gotoPairPrimary(primaryPage, { accountId, accessToken })
    const qrPayload = await readQrPayload(primaryPage)

    // DevicePairing:SessionLifetimeSeconds=8 (playwright.config.ts) -- wait comfortably past
    // it before attempting the claim.
    await new Promise((resolve) => setTimeout(resolve, 10_000))

    const newContext = await newDeviceContext(browser)
    const newPage = await newContext.newPage()

    const claimResponse = newPage.waitForResponse((response) => response.url().includes('/claim') && response.request().method() === 'POST')
    await gotoPairNew(newContext, newPage, qrPayload)

    const response = await claimResponse
    expect(response.status(), 'claiming an expired session must be rejected, not silently accepted').toBe(404)

    await expect(newPage.getByRole('alert')).toBeVisible()

    await primaryContext.close()
    await newContext.close()
  })

  test('replayed claim is rejected', async ({ request, browser }) => {
    const { accountId, accessToken } = await registerPatientAccount(request)

    const primaryContext = await newDeviceContext(browser)
    const primaryPage = await primaryContext.newPage()
    await gotoPairPrimary(primaryPage, { accountId, accessToken })
    const qrPayload = await readQrPayload(primaryPage)

    // First claim: a genuine new device, scanning the code for the first (and only
    // legitimate) time.
    const firstContext = await newDeviceContext(browser)
    const firstPage = await firstContext.newPage()
    const firstClaimResponse = firstPage.waitForResponse(
      (response) => response.url().includes('/claim') && response.request().method() === 'POST',
    )
    await gotoPairNew(firstContext, firstPage, qrPayload)
    expect((await firstClaimResponse).status()).toBe(200)

    // Second claim: a DIFFERENT context/page presenting the exact same QR payload -- the
    // scenario a photographed/shoulder-surfed QR code is meant to be worthless against
    // (DevicePairingIssuer.Claim's own doc comment: "First caller wins").
    const replayContext = await newDeviceContext(browser)
    const replayPage = await replayContext.newPage()
    const replayClaimResponse = replayPage.waitForResponse(
      (response) => response.url().includes('/claim') && response.request().method() === 'POST',
    )
    await gotoPairNew(replayContext, replayPage, qrPayload)

    const replayResponse = await replayClaimResponse
    expect(replayResponse.status(), 'a second claim of an already-claimed session must be rejected').toBe(404)
    await expect(replayPage.getByRole('alert')).toBeVisible()

    await primaryContext.close()
    await firstContext.close()
    await replayContext.close()
  })

  test('network traffic never contains the KEK in cleartext', async ({ request, browser }) => {
    const { accountId, accessToken } = await registerPatientAccount(request)

    const kekBase64 = toBase64(TEST_KEK)
    const kekHexLower = Buffer.from(TEST_KEK).toString('hex')
    const kekHexUpper = kekHexLower.toUpperCase()
    const kekRawLatin1 = Buffer.from(TEST_KEK).toString('latin1')

    const capturedBodies: string[] = []

    function watch(page: Page, label: string) {
      page.on('request', (req) => {
        const data = req.postData()
        if (data) {
          capturedBodies.push(`[${label} request ${req.method()} ${req.url()}] ${data}`)
        }
      })
      page.on('response', (res) => {
        void res
          .text()
          .then((body) => {
            if (body) {
              capturedBodies.push(`[${label} response ${res.status()} ${res.url()}] ${body}`)
            }
          })
          .catch(() => {
            // Non-text bodies (there are none in this API, but be defensive) -- nothing to
            // scan for a text-encoded KEK leak in that case.
          })
      })
    }

    const primaryContext = await newDeviceContext(browser)
    const primaryPage = await primaryContext.newPage()
    watch(primaryPage, 'primary')
    await gotoPairPrimary(primaryPage, { accountId, accessToken, kek: TEST_KEK })
    const qrPayload = await readQrPayload(primaryPage)

    const newContext = await newDeviceContext(browser)
    const newPage = await newContext.newPage()
    watch(newPage, 'new-device')
    const { kekAdopted } = await gotoPairNew(newContext, newPage, qrPayload)

    // Drive the full handshake to completion so every leg of traffic (create, claim, the
    // primary's claim-status poll, the payload submission, the new device's payload poll)
    // actually happens.
    const adoptedKek = await kekAdopted
    expect(adoptedKek).toEqual(TEST_KEK)
    await expect(newPage.getByRole('status')).toBeVisible()

    // Give any still-in-flight response body handlers a moment to finish (`res.text()`
    // above is fire-and-forget relative to the events themselves).
    await newPage.waitForTimeout(500)

    expect(capturedBodies.length, 'expected at least one captured request/response body').toBeGreaterThan(0)

    for (const body of capturedBodies) {
      expect(body, 'raw KEK bytes (latin1) must never appear on the wire').not.toContain(kekRawLatin1)
      expect(body, 'KEK base64 must never appear on the wire').not.toContain(kekBase64)
      expect(body, 'KEK hex (lowercase) must never appear on the wire').not.toContain(kekHexLower)
      expect(body, 'KEK hex (uppercase) must never appear on the wire').not.toContain(kekHexUpper)
    }

    await primaryContext.close()
    await newContext.close()
  })

  test('new device adopts a working KEK', async ({ request, browser }) => {
    const { accountId, accessToken } = await registerPatientAccount(request)

    // S03/patient-records does not exist yet, so this stands in for a real unwrap: wrap a known DEK
    // with the original Node-side KEK and unwrap it with whatever KEK the browser reports back,
    // proving the adopted bytes are the same key material.
    const testDek = Uint8Array.from({ length: 32 }, (_, i) => (i * 3 + 5) % 256)
    const aad = new TextEncoder().encode('device-pairing-e2e-wrap-aad')
    const wrappedDek = wrapDek(TEST_KEK, testDek, aad)

    const primaryContext = await newDeviceContext(browser)
    const primaryPage = await primaryContext.newPage()
    await gotoPairPrimary(primaryPage, { accountId, accessToken, kek: TEST_KEK })
    const qrPayload = await readQrPayload(primaryPage)

    const newContext = await newDeviceContext(browser)
    const newPage = await newContext.newPage()
    const { kekAdopted } = await gotoPairNew(newContext, newPage, qrPayload)

    const adoptedKek = await kekAdopted

    await expect(newPage.getByRole('status')).toBeVisible()
    await expect(newPage.getByRole('status')).toHaveText('Dispositivo pareado com sucesso.')

    // The KEK the new device reports back is byte-for-byte what the primary sent.
    expect(adoptedKek).toEqual(TEST_KEK)

    // And it is not merely equal -- it is actually USABLE: unwrapping (Node-side, using
    // @limmiar/crypto directly, not the browser) with exactly the KEK the new device
    // adopted recovers the original DEK byte-for-byte.
    const recoveredDek = unwrapDek(adoptedKek, wrappedDek, aad)
    expect(recoveredDek).toEqual(testDek)

    await primaryContext.close()
    await newContext.close()
  })
})
