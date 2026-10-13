import { test, expect, type Page } from '@playwright/test'
import { abrirCarteira, abrirConfiguracao, registrarProfissionalNaInterface as register, entrarProfissionalNaInterface, voltarAoInicio, SENHA_PROFISSIONAL_TESTE as PASSWORD } from './fixtures/profissional-interface'

async function login(page: Page, account: { email: string; secret: string }) {
  await entrarProfissionalNaInterface(page, account)
  await page.goto('/devices/pair-new')
  await expect(page.getByLabel('Código de pareamento', { exact: true })).toBeVisible()
}
async function openQr(page: Page) {
  await abrirConfiguracao(page, 'Parear novo dispositivo')
  expect(new URL(page.url()).search).toBe('')
  await page.getByLabel('Senha atual', { exact: true }).fill(PASSWORD)
  const created = page.waitForResponse(response => /\/accounts\/[^/]+\/devices\/pairing-sessions$/.test(response.url()) && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Gerar código de pareamento', exact: true }).click()
  const response = await created
  expect(response.ok()).toBe(true)
  const { expiresAt } = await response.json()
  const textbox = page.getByRole('textbox', { name: 'Código de pareamento', exact: true })
  await expect(textbox).toBeVisible()
  return { qr: await textbox.inputValue(), expiresAt }
}
async function claim(page: Page, qr: string) {
  await page.getByLabel('Código de pareamento', { exact: true }).fill(qr)
  await page.getByRole('button', { name: 'Usar código de pareamento', exact: true }).click()
}

test.describe('pareamento em rotas de produção', () => {
  test.use({ locale: 'pt-BR' })
  test.setTimeout(90000)
  test('reabre o prontuário com a mesma KEK após conferir os códigos, sem chave na URL ou no storage', async ({ page, browser, request }) => {
    const account = await register(page, request)
    const name = `Paciente fictício ${crypto.randomUUID()}`
    await abrirCarteira(page)
    await page.locator('summary').filter({ hasText: /^Adicionar paciente$/ }).click()
    await page.getByLabel('Nome do paciente', { exact: true }).fill(name)
    await page.getByRole('button', { name: 'Adicionar paciente', exact: true }).click()
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
    await voltarAoInicio(page)
    const context = await browser.newContext({ locale: 'pt-BR', baseURL: test.info().project.use.baseURL })
    try {
      const secondary = await context.newPage()
      await login(secondary, account)
      const { qr } = await openQr(page)
      const bodies: string[] = []
      page.on('request', request => { if (request.method() === 'POST' && /\/devices\/pairing-sessions\/[^/]+\/payload$/.test(request.url())) bodies.push(request.postData()!) })
      await claim(secondary, qr)
      await expect(secondary.getByTestId('pairing-confirmation')).toBeVisible()
      await expect(page.getByTestId('pairing-confirmation')).toHaveText(await secondary.getByTestId('pairing-confirmation').innerText())
      expect(bodies).toHaveLength(0)
      await page.getByRole('button', { name: 'Os códigos são iguais. Liberar acesso.', exact: true }).click()
      await expect(secondary.getByText('Prontuários desbloqueados neste dispositivo.', { exact: true })).toBeVisible()
      expect(bodies).toHaveLength(1)
      expect(Object.keys(JSON.parse(bodies[0]))).toEqual(['encryptedKek'])
      expect(Buffer.from(JSON.parse(bodies[0]).encryptedKek, 'base64')).toHaveLength(60)
      expect(bodies[0]).not.toContain(PASSWORD)
      expect(bodies[0]).not.toContain(name)
      await abrirCarteira(secondary)
      await expect(secondary.getByRole('link', { name, exact: true })).toBeVisible()
      const stored = await secondary.evaluate(() => sessionStorage.getItem('limmiar:account'))
      expect(stored).not.toContain('kek')
      expect(stored).not.toContain(name)
    } finally { await context.close() }
  })
  test('QR expirado é recusado no servidor', async ({ page, browser, request }) => {
    const account = await register(page, request)
    const context = await browser.newContext({ locale: 'pt-BR', baseURL: test.info().project.use.baseURL })
    try {
      const secondary = await context.newPage()
      await login(secondary, account)
      const { qr, expiresAt } = await openQr(page)
      test.setTimeout(Math.max(90000, new Date(expiresAt).getTime() - Date.now() + 60000))
      await page.waitForTimeout(Math.max(0, new Date(expiresAt).getTime() - Date.now() + 250))
      const response = secondary.waitForResponse(response => response.url().endsWith('/claim'))
      await claim(secondary, qr)
      expect((await response).status()).toBe(404)
      await expect(secondary.getByRole('alert')).toBeVisible()
    } finally { await context.close() }
  })
  test('um segundo dispositivo não consegue reutilizar o mesmo QR', async ({ page, browser, request }) => {
    const account = await register(page, request)
    const firstContext = await browser.newContext({ locale: 'pt-BR', baseURL: test.info().project.use.baseURL })
    const secondContext = await browser.newContext({ locale: 'pt-BR', baseURL: test.info().project.use.baseURL })
    try {
      const first = await firstContext.newPage(), second = await secondContext.newPage()
      await login(first, account)
      await login(second, account)
      const { qr } = await openQr(page)
      await claim(first, qr)
      await expect(first.getByTestId('pairing-confirmation')).toBeVisible()
      const response = second.waitForResponse(response => response.url().endsWith('/claim'))
      await claim(second, qr)
      expect((await response).status()).toBe(404)
      await expect(second.getByRole('alert')).toBeVisible()
    } finally { await firstContext.close(); await secondContext.close() }
  })
})
