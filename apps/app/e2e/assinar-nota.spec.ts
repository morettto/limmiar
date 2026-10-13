import { test, expect } from '@playwright/test'
import { abrirAbaDaSessao, abrirCarteira, iniciarSessaoAgora, registrarProfissionalNaInterface } from './fixtures/profissional-interface'

// S08-01: o editor SOAP assina só com teclado -- escrever e Ctrl+Enter, sem tocar no botão. O
// profissional entra pela interface, abre a pasta pelo link da carteira e inicia uma sessão agora: a
// KEK vive só na memória da página, então um `page.goto('/pacientes/...')` cairia no login.

test.describe('Editor SOAP -- assinar só com teclado (S08-01)', () => {
  test.use({ locale: 'pt-BR' })

  test('escrever no editor e Ctrl+Enter assinam a nota gravada no prontuário', async ({ page, request }) => {
    await registrarProfissionalNaInterface(page, request)
    await abrirCarteira(page)

    const nome = `ASSINATURA-TECLADO-${crypto.randomUUID()}`
    const carteira = page.getByRole('region', { name: 'Pacientes', exact: true })
    await carteira.locator('details.patient-add > summary').click()
    await carteira.getByLabel('Nome do paciente', { exact: true }).fill(nome)
    await carteira.getByRole('button', { name: 'Adicionar paciente', exact: true }).click()
    await carteira.getByRole('link', { name: nome, exact: true }).click()
    await iniciarSessaoAgora(page)
    await abrirAbaDaSessao(page, 'Nota')

    const nota = page.getByRole('region', { name: 'Nota da sessão', exact: true })
    const subjetivo = nota.getByRole('textbox', { name: 'Subjetivo 1', exact: true })
    await subjetivo.focus()
    await page.keyboard.type('Paciente relata melhora dos sintomas.')
    await page.keyboard.press('Control+Enter')

    await expect(nota.getByRole('status')).toHaveText('Nota assinada e salva no prontuário.')
    await expect(subjetivo).toHaveValue('Paciente relata melhora dos sintomas.')
    await expect(subjetivo).toHaveAttribute('readonly', '')
    await expect(nota.getByRole('button', { name: 'Assinar nota', exact: true })).toBeDisabled()
  })
})
