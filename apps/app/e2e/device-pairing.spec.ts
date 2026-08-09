import { test, expect, type Browser, type Page, type BrowserContext, type APIRequestContext } from '@playwright/test'
import { unwrapDek, wrapDek } from '@limmiar/crypto'
import { API_BASE_URL } from '../playwright.config'

// S02-04 slice 7: the first multi-browser-context, network-capturing E2E test in this repo.
// Two independently-generated `browser.newContext()`s stand in for "two physically different
// devices" (separate cookie/storage jars -- unlike two tabs, neither can see the other's
// state), which is what makes this a real test of the RELAY (this repo's actual API, running
// as a Playwright `webServer` -- see playwright.config.ts's third `webServer` entry) rather
// than two components exercising each other's mocks.
//
// PairPrimaryDevice/PairNewDevice have no real navigation entry point yet -- router.tsx's own
// doc comment explains the two test-only routes ('/devices/pair-primary', '/devices/pair-new')
// this spec drives them through instead, and why that is a deliberate, ticket-scoped shortcut
// rather than production UI.
//
// This spec exercises the PAIRING PROTOCOL specifically -- not login (already covered by
// S02-01's own E2E) and not a real Keychain/DEK-KEK unlock (S01/S03): every test authenticates
// via a direct POST /auth/register call (Patient role, so registration alone returns a session
// -- no TOTP dance), and every test's KEK is a fixed, known 32-byte value the test itself
// supplies, never one derived from a real password.

/**
 * A fixed, known, non-zero 32-byte KEK, distinct from anything a real Argon2id/BIP39
 * derivation could plausibly produce by coincidence -- deliberately NOT all-zero, so a bug
 * that zero-fills a buffer instead of actually copying the KEK would not silently pass the
 * "adopts a working KEK" test.
 */
const TEST_KEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 11) % 256)

/**
 * `browser.newContext()` (unlike the `context`/`page` fixtures `test.use({ locale })` would
 * otherwise configure) picks up the OS/CI host's locale by default -- ADR-S00.5-05's boot
 * order (see i18n.ts's `initialLocale`) then resolves whatever that host locale is, which is
 * not necessarily one this repo ships a compiled catalog for. Pinning it to pt-BR (the
 * source locale, per lingui.config.ts -- guaranteed to have every message compiled) keeps
 * this spec's UI-text assertions independent of the host machine's locale.
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
 * Navigates a context to the pair-new test route with `decode` wired to resolve with
 * `qrPayload` (standing in for a camera scan of the primary's QR code -- see
 * PairingScan.tsx's own `decode` prop doc comment for why this seam exists in production
 * code, not just tests). `onKekAdopted` results are relayed back to this Node process via
 * `page.exposeFunction`, captured into the returned `kekAdopted` promise.
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
  // Serial, not this file's default `fullyParallel`: every test in this file shares ONE
  // running API process (playwright.config.ts's webServer), and that process's pairing
  // session TTL is configured short (DevicePairing:SessionLifetimeSeconds=8) specifically so
  // "expired QR is rejected" can observe a real expiry without a 2-minute wait. Running the
  // four tests one at a time keeps that shared 8-second budget from ever being squeezed by
  // unrelated parallel work on the same machine.
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

    // S03/patient-records does not exist yet -- this stands in for a real "unwrap a
    // per-patient DEK with the account's KEK" scenario (this ticket's own plan calls for a
    // wrapDek/unwrapDek round trip in its place): prove the KEK the new device actually
    // adopted is not just "some 32 bytes" but the SAME key material a real wrapDek/unwrapDek
    // round trip needs, by wrapping a known DEK with the ORIGINAL (Node-side) KEK ahead of
    // time and unwrapping it with whatever KEK the browser reports back.
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
