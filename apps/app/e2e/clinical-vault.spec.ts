import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { perfilDeVozSintetico } from './fixtures/perfil-de-voz-sintetico'
import type { VaultDocument } from '../src/entities/clinical-vault/crypto'

test('chave única, bloqueio e recuperação preservam paciente cifrado', async ({ page }, info) => {
  const account = { id: '11111111-1111-4111-8111-111111111111', email: 'profissional@example.test', role: 'Professional',
    accessToken: 'synthetic-token', refreshToken: 'synthetic-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z', twoFactorRequirement: 'NotApplicable' }
  await page.addInitScript(account => { sessionStorage.setItem('limmiar:account', JSON.stringify(account)) }, account)
  let vault: Record<string, unknown> | null = null
  const patients: Record<string, unknown>[] = []
  const mutations: string[] = []
  let voice: Awaited<ReturnType<typeof perfilDeVozSintetico>> | undefined
  await page.route('**/accounts/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path.endsWith('/voice-enrollment')) return route.fulfill({ status: voice ? 200 : 404, json: voice ?? { code: 'voice.enrollment_not_found', params: {} } })
    if (request.method() === 'GET' && path.endsWith('/clinical-vault')) {
      return route.fulfill({ status: vault ? 200 : 404, json: vault ?? { code: 'clinical_vault.not_found', params: {} } })
    }
    if (request.method() === 'POST' && path.includes('/clinical-vault')) {
      mutations.push(request.postData()!)
      const body = request.postDataJSON()
      if (path.endsWith('/recover') && vault?.revision !== body.expectedRevision) return route.fulfill({ status: 409, json: { code: 'clinical_vault.conflict', params: {} } })
      const document = body.document ?? body
      vault = { ...document, recoverySlots: document.recoverySlots.map((slot: { id: string; envelope: string }) => ({ id: slot.id, envelope: slot.envelope })) }
      return route.fulfill({ status: 204 })
    }
    if (path.endsWith('/patients')) {
      if (request.method() === 'POST') {
        mutations.push(request.postData()!)
        const body = request.postDataJSON()
        patients.push({ ...body, createdAt: new Date().toISOString() })
        return route.fulfill({ status: 201, json: { patientId: body.patientId, createdAt: new Date().toISOString() } })
      }
      return route.fulfill({ json: { patients } })
    }
    return route.fulfill({ json: { status: 'Active', items: [], appointments: [], sessions: [] } })
  })
  await page.goto('/pacientes')
  await expect(page.getByRole('heading', { name: 'Proteja seus prontuários' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('01-introducao.png'), fullPage: true })
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.getByRole('button', { name: 'Gerar minha chave pessoal' }).click()
  const key = await page.locator('.vault-secret').textContent()
  const codes = await page.locator('.vault-codes code').allTextContents()
  expect(codes).toHaveLength(3)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar kit de acesso' }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('limmiar-kit-de-acesso.txt')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const kit = Buffer.concat(chunks).toString('utf8')
  for (const value of [key!, ...codes]) expect(kit).toContain(value)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: info.outputPath('02-kit-mobile.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.getByLabel('Últimos 6 caracteres da chave pessoal').fill(key!.slice(-6))
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Concluir e abrir consultório' }).click()
  await expect(page.getByRole('heading', { name: 'Vamos reconhecer a sua voz' })).toBeVisible()
  await expect(page.locator('.app-bar')).not.toBeVisible()
  await expect(page.locator('details.patient-add')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).not.toBeVisible()
  await page.screenshot({ path: info.outputPath('03-voz-obrigatoria-mobile.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({ path: info.outputPath('04-voz-obrigatoria-desktop.png'), fullPage: true })
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  voice = await perfilDeVozSintetico(account.id, key!, vault as unknown as VaultDocument)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.getByLabel('Chave pessoal', { exact: true }).fill(key!)
  await page.getByRole('button', { name: 'Desbloquear prontuários' }).click()
  await page.locator('details.patient-add > summary').click()
  await page.getByLabel('Nome do paciente', { exact: true }).fill('Paciente sintético protegido')
  await page.getByRole('button', { name: 'Adicionar paciente' }).click()
  await expect(page.getByRole('link', { name: 'Paciente sintético protegido' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Chave pessoal', { exact: true })).toBeVisible()
  await expect(page.getByText('Paciente sintético protegido')).toHaveCount(0)
  await expect(page.locator('.vault-secret')).toHaveCount(0)
  await page.getByLabel('Chave pessoal', { exact: true }).fill('senha-do-login')
  await page.getByRole('button', { name: 'Desbloquear prontuários' }).click()
  await expect(page.getByRole('alert')).toContainText('Chave inválida')
  await page.getByRole('button', { name: 'Perdi minha chave pessoal' }).click()
  await page.getByLabel('Código de recuperação', { exact: true }).fill(codes[0]!)
  await page.getByRole('button', { name: 'Gerar nova chave', exact: true }).click()
  const newKey = await page.locator('.vault-secret').textContent()
  expect(newKey).not.toBe(key)
  await page.getByLabel('Últimos 6 caracteres da chave pessoal').fill(newKey!.slice(-6))
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Concluir e abrir consultório' }).click()
  await expect(page.getByRole('link', { name: 'Paciente sintético protegido' })).toBeVisible()
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.getByRole('button', { name: 'Bloquear prontuários', exact: true }).click()
  await page.getByLabel('Chave pessoal', { exact: true }).fill(key!)
  await page.getByRole('button', { name: 'Desbloquear prontuários' }).click()
  await expect(page.getByRole('alert')).toContainText('Chave inválida')
  await page.getByRole('button', { name: 'Perdi minha chave pessoal' }).click()
  await page.getByLabel('Código de recuperação', { exact: true }).fill(codes[1]!)
  await page.getByRole('button', { name: 'Gerar nova chave', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Código inválido')
  await page.getByRole('button', { name: 'Voltar ao desbloqueio' }).click()
  await page.getByLabel('Chave pessoal', { exact: true }).fill(newKey!)
  await page.getByRole('button', { name: 'Desbloquear prontuários' }).click()
  await expect(page.getByRole('link', { name: 'Paciente sintético protegido' })).toBeVisible()
  const storage = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))
  for (const secret of [key!, newKey!, ...codes]) {
    expect(mutations.join('\n')).not.toContain(secret)
    expect(storage).not.toContain(secret)
  }
  expect(mutations.join('\n')).not.toContain('Paciente sintético protegido')
})
