import { test, expect } from '@playwright/test'
import { abrirAbaDaSessao, abrirCarteira, abrirConfiguracao, iniciarSessaoAgora } from './fixtures/profissional-interface'
import { computeTotpCode } from './fixtures/totp'

test.describe('Recuperação BIP39 em rotas de produto', () => {
  test.use({ locale: 'pt-BR' })

  test('restaura a chave e a sessão em navegador limpo sem a senha antiga', async ({ page, browser, request }) => {
    test.setTimeout(60_000)
    const email = `recovery-${crypto.randomUUID()}@example.com`
    const password = 'Recuperacao-teste-2026!'
    await page.goto('/')
    await page.getByLabel('E-mail', { exact: true }).fill(email)
    await page.getByLabel('Senha', { exact: true }).fill(password)
    const registeredResponse = page.waitForResponse(response => response.url().endsWith('/auth/register') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click()
    const registered = await registeredResponse
    const { id: accountId } = await registered.json() as { id: string }
    const secret = await page.getByLabel('Código secreto', { exact: true }).inputValue()
    await page.getByLabel('Código de 6 dígitos do aplicativo autenticador', { exact: true }).fill(computeTotpCode(secret, Math.floor(Date.now() / 1000)))
    await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
    await page.getByRole('button', { name: 'Guardei meus códigos', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Consultório', exact: true })).toBeVisible()
    await page.getByLabel('Referência do documento', { exact: true }).fill('Documento fictício de teste E2E')
    await page.getByRole('button', { name: 'Enviar para revisão', exact: true }).click()
    await expect(page.getByText('Documento recebido. Sua conta aguarda a aprovação da equipe.', { exact: true })).toBeVisible()
    const decision = await request.post(`${new URL(registered.url()).origin}/accounts/${accountId}/professional-verification/decision`, {
      headers: { 'X-Staff-Api-Key': 'e2e-unused-staff-key' },
      data: { approved: true, rejectionReason: null },
    })
    expect(decision.ok()).toBe(true)
    await page.getByRole('button', { name: 'Atualizar verificação', exact: true }).click()
    await abrirCarteira(page)
    const patientName = `Paciente fictício ${crypto.randomUUID()}`
    const statement = 'Paciente fictício relata dificuldade de sono durante a semana.'
    await page.locator('details.patient-add > summary').click()
    await page.getByLabel('Nome do paciente', { exact: true }).fill(patientName)
    await page.getByRole('button', { name: 'Adicionar paciente', exact: true }).click()
    await page.getByRole('link', { name: patientName, exact: true }).click()
    await iniciarSessaoAgora(page)
    await abrirAbaDaSessao(page, 'Nota')
    await page.getByLabel('Subjetivo 1', { exact: true }).fill(statement)
    await page.getByRole('button', { name: 'Assinar nota', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Nota da sessão', exact: true }).getByRole('status')).toHaveText('Nota assinada e salva no prontuário.')
    await abrirConfiguracao(page, 'Frase de recuperação')
    await page.getByLabel('Senha atual', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Gerar frase de recuperação', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Guarde sua frase de recuperação', exact: true })).toBeVisible()
    const items = await page.locator('ol li').allTextContents()
    expect(items).toHaveLength(24)
    const mnemonic = items.map(item => item.replace(/^\d+\.\s*/, '')).join(' ')
    await page.getByRole('button', { name: 'Guardei minha frase', exact: true }).click()
    await expect(page.getByText('Frase de recuperação salva.', { exact: true })).toBeVisible()
    const context = await browser.newContext({ locale: 'pt-BR', baseURL: test.info().project.use.baseURL })
    try {
      const recovered = await context.newPage()
      await recovered.goto('/recover')
      await recovered.getByLabel('E-mail', { exact: true }).fill(email)
      await recovered.getByLabel('Frase de recuperação', { exact: true }).fill(mnemonic)
      await recovered.getByRole('button', { name: 'Recuperar acesso', exact: true }).click()
      await expect(recovered.getByRole('button', { name: 'Verificar', exact: true })).toBeVisible()
      await recovered.getByLabel('Código de verificação', { exact: true }).fill(computeTotpCode(secret, Math.floor(Date.now() / 1000)))
      await recovered.getByRole('button', { name: 'Verificar', exact: true }).click()
      await expect(recovered.getByRole('heading', { name: 'Consultório', exact: true })).toBeVisible()
      await expect(recovered.getByTestId('conta-sessao')).toHaveText(email)
      await expect(recovered.getByRole('button', { name: 'Sair', exact: true })).toBeVisible()
      await abrirCarteira(recovered)
      await recovered.getByRole('link', { name: patientName, exact: true }).click()
      await expect(recovered.getByText('Sem transcrição · Nota assinada', { exact: true })).toBeVisible()
      await recovered.getByRole('link', { name: /^Sessão de / }).click()
      await abrirAbaDaSessao(recovered, 'Nota')
      await expect(recovered.getByLabel('Subjetivo 1', { exact: true })).toHaveValue(statement)
      await expect(recovered.getByRole('button', { name: 'Assinar nota', exact: true })).toBeDisabled()
      expect(await recovered.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await recovered.screenshot({ path: test.info().outputPath('prontuario-recuperado.png'), fullPage: true })
    } finally { await context.close() }
  })

  test('recusa frase malformada sem indicar uma palavra específica', async ({ page }) => {
    await page.goto('/recover')
    await page.getByLabel('E-mail', { exact: true }).fill(`invalid-${crypto.randomUUID()}@example.com`)
    await page.getByLabel('Frase de recuperação', { exact: true }).fill('esta nao e uma frase valida de recuperacao bip39 apenas palavras aleatorias')
    await page.getByRole('button', { name: 'Recuperar acesso', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('Frase de recuperação inválida. Verifique se você digitou todas as palavras corretamente.')
  })
})
