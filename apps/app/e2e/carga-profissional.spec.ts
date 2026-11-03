import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { planoDaCarga, SAIDA } from './fixtures/atendimento/carga-plano'
import { rotearCopiloto } from './fixtures/atendimento/copiloto-real'
import { servirModeloDeVoz } from './fixtures/modelo-de-voz'
import { abrirConfiguracao, registrarProfissionalNaInterface, voltarAoInicio } from './fixtures/profissional-interface'

// Carga com o copiloto real (playwright.carga.config.ts): cria o profissional do tema, guarda as 5 obras dele no acervo
// pela tela, espera o copiloto preparar todas e cadastra a voz com o microfone falso. As credenciais de teste ficam em
// .local/simulacao-laya/e2e-ui para as sessões do mesmo profissional.

const plano = planoDaCarga()

test('profissional da carga: conta, acervo real e voz', async ({ page, request }, info) => {
  const profissional = plano.profissionais.find((p) => p.tema === info.project.metadata.tema)!
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = (restricoes) =>
      original({ ...restricoes, audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false } })
  })
  const modelos = await servirModeloDeVoz(page)
  await rotearCopiloto(page)
  try {
    const conta = await registrarProfissionalNaInterface(page, request)
    await page.getByRole('link', { name: 'Acervo pessoal', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Seu acervo', exact: true })).toBeVisible()
    for (const obra of profissional.obras) {
      await page.getByLabel('Arquivo do material', { exact: true }).setInputFiles(obra.path)
      // o app lê título e autores do PDF e preenche os campos; o teste só escreve depois, para não ser sobrescrito
      await expect(page.getByRole('status').filter({ hasText: 'Dados do documento carregados.' })).toBeVisible()
      await page.getByLabel('Título da obra', { exact: true }).fill(obra.title)
      await page.getByLabel('Autores', { exact: true }).fill(obra.authors.join('; '))
      await page.getByRole('button', { name: 'Guardar no acervo', exact: true }).click()
      await expect(page.locator('li.material-row').filter({ hasText: obra.title })).toBeVisible({ timeout: 120_000 })
    }
    const inicio = Date.now()
    // a autorização só fica disponível depois que o copiloto prepara a obra (AcervoPage: disabled={busy || !ready})
    for (const obra of profissional.obras) {
      const linha = page.locator('li.material-row').filter({ hasText: obra.title })
      await expect(linha.getByText('Pronto para selecionar na sessão', { exact: true })).toBeVisible({ timeout: 90 * 60_000 })
      const autorizar = linha.getByRole('checkbox', { name: 'Autorizar nas minhas consultas', exact: true })
      await expect(autorizar).toBeEnabled({ timeout: 120_000 })
      // caixa controlada: só marca quando o PUT da autorização volta, por isso clique e espera em vez de check()
      await autorizar.click()
      await expect(autorizar).toBeChecked({ timeout: 60_000 })
      await expect(page.getByRole('status').filter({ hasText: 'Material disponível para selecionar nas suas sessões.' })).toBeVisible()
      await expect(linha.getByText('Guardado · uso não autorizado', { exact: true })).toHaveCount(0)
    }
    const preparoS = Math.round((Date.now() - inicio) / 1000)
    await voltarAoInicio(page)
    await abrirConfiguracao(page, 'Identificação da sua voz')
    await page.getByRole('checkbox', { name: 'Autorizo o uso do microfone para cadastrar minha voz.' }).click()
    // o cadastro da conta já deixa um perfil sintético (prepararVozSintetica); o da voz falsa do microfone o substitui
    await page.getByRole('button', { name: /^(Cadastrar minha voz|Substituir perfil de voz)$/ }).click()
    await expect(page.getByRole('status').filter({ hasText: /Perfil de voz salvo|Não foi possível cadastrar/ }))
      .toHaveText('Perfil de voz salvo. Ele será usado nas próximas sessões.', { timeout: 90_000 })
    mkdirSync(SAIDA, { recursive: true })
    writeFileSync(join(SAIDA, `conta-${profissional.tema}.json`), JSON.stringify(conta))
    writeFileSync(join(SAIDA, `acervo-${profissional.tema}.json`), JSON.stringify({ tema: profissional.tema, obras: profissional.obras.map((o) => o.pmcid), preparoS }))
  } finally {
    modelos.close()
  }
})
