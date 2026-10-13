import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { computeTotpCode } from './totp'

export const SENHA_PROFISSIONAL_TESTE = 'Pareamento-profissional-2026!'
const STAFF = process.env.LIMMIAR_E2E_STAFF_API_KEY ?? 'e2e-unused-staff-key'
export interface ProfissionalTeste { email: string; secret: string }

export async function registrarProfissionalNaInterface(page: Page, request: APIRequestContext): Promise<ProfissionalTeste> {
  const email = `profissional-${crypto.randomUUID()}@example.com`
  await page.goto('/')
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(SENHA_PROFISSIONAL_TESTE)
  const registration = page.waitForResponse(response => response.url().endsWith('/auth/register') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click()
  const registered = await registration
  expect(registered.ok()).toBe(true)
  const { id } = await registered.json()
  const secret = await page.getByLabel('Código secreto', { exact: true }).inputValue()
  await page.getByLabel('Código de 6 dígitos do aplicativo autenticador', { exact: true }).fill(computeTotpCode(secret, Math.floor(Date.now() / 1000)))
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await page.getByRole('button', { name: 'Guardei meus códigos', exact: true }).click()
  await page.getByLabel('Referência do documento', { exact: true }).fill('Documento fictício de teste da interface')
  await page.getByRole('button', { name: 'Enviar para revisão', exact: true }).click()
  await expect(page.getByText('Documento recebido. Sua conta aguarda a aprovação da equipe.', { exact: true })).toBeVisible()
  const decision = await request.post(`${new URL(registered.url()).origin}/accounts/${id}/professional-verification/decision`, {
    headers: { 'X-Staff-Api-Key': STAFF }, data: { approved: true, rejectionReason: null },
  })
  expect(decision.ok()).toBe(true)
  await page.getByRole('button', { name: 'Atualizar verificação', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Painel do consultório', exact: true })).toBeVisible()
  return { email, secret }
}

export async function entrarProfissionalNaInterface(page: Page, account: ProfissionalTeste): Promise<void> {
  await page.goto('/')
  await page.getByLabel('E-mail', { exact: true }).fill(account.email)
  await page.getByLabel('Senha', { exact: true }).fill(SENHA_PROFISSIONAL_TESTE)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.getByRole('button', { name: 'Acessar conta', exact: true }).click()
  await page.getByLabel('Código de verificação', { exact: true }).fill(computeTotpCode(account.secret, Math.floor(Date.now() / 1000)))
  await page.getByRole('button', { name: 'Verificar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible()
}

/** Da pasta do paciente: "Iniciar sessão agora" cria o agendamento na hora e abre a página da sessão. */
export async function iniciarSessaoAgora(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Iniciar sessão agora', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Sessão de / })).toBeVisible()
}

export async function abrirAbaDaSessao(page: Page, aba: 'Insights' | 'Nota'): Promise<void> {
  const link = page.getByRole('navigation', { name: 'Seções da sessão', exact: true }).getByRole('link', { name: aba, exact: true })
  await link.click()
  await expect(link).toHaveAttribute('aria-current', 'page')
}

/** A navegação principal da barra do consultório; "Pacientes" também existe no caminho de volta das pastas. */
export function navegacaoPrincipal(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Navegação principal', exact: true })
}

/** De qualquer tela: abre a carteira de pacientes pela barra. */
export async function abrirCarteira(page: Page): Promise<void> {
  await navegacaoPrincipal(page).getByRole('link', { name: 'Pacientes', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Pacientes', exact: true })).toBeVisible()
}

/** De qualquer tela: volta à Home pelo "Consultório" da barra. */
export async function voltarAoInicio(page: Page): Promise<void> {
  await navegacaoPrincipal(page).getByRole('link', { name: 'Consultório', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Painel do consultório', exact: true })).toBeVisible()
}

/** De qualquer tela: abre uma tela de configuração pelo menu "Conta" da barra. */
export async function abrirConfiguracao(page: Page, nome: string): Promise<void> {
  await page.getByRole('button', { name: 'Conta', exact: true }).click()
  await page.getByRole('link', { name: nome, exact: true }).click()
}
