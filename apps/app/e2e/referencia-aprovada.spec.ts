import { test, expect } from '@playwright/test'
import { axeBuilder } from '../src/test-support/axe'
import { createHash, randomUUID } from 'node:crypto'
import { codificarWav } from '../../../packages/audio/src/wav'
import { modeloDeVozInstalado, servirModeloDeVoz } from './fixtures/modelo-de-voz'
import { simularCopiloto } from './fixtures/atendimento/copiloto-simulado'
import { abrirAbaDaSessao, abrirCarteira, abrirConfiguracao, entrarProfissionalNaInterface, iniciarSessaoAgora, registrarProfissionalNaInterface } from './fixtures/profissional-interface'

test.use({
  locale: 'pt-BR',
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
})
test.skip(!modeloDeVozInstalado(), 'Modelo de voz ausente: rode `node tools/voice-identity/setup.mjs`.')

test('aprovação explícita mantém fonte e revisão na nota cifrada e assinada reaberta em navegador limpo', async ({ page, browser, request }) => {
  test.setTimeout(90_000)
  const name = 'REFERENCIA-SINTETICA-' + randomUUID()
  const phrase = 'Tenho medo nesta situação sintética.'
  const title = 'Livro sintético de verificação ' + randomUUID()
  const citation = 'Citação sintética usada para testar a aprovação, sem validade clínica.'
  const errors: string[] = []
  const mutations: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/accounts/') && request.method() !== 'GET') mutations.push(request.postData() ?? '') })
  // O wrangler dev não serve /models/: o extrator de voz (TitaNet) vem de um servidor local.
  await servirModeloDeVoz(page)
  // FRONTEIRA SIMULADA: o gateway de fala (WebSocket /speech) não roda no E2E. Ao receber o pedido de conclusão, devolve a frase
  // inteira como uma palavra dita pelo paciente.
  await page.routeWebSocket(/\/speech\/v1\/fala$/, (ws) => {
    ws.onMessage((mensagem) => {
      const tipo = typeof mensagem === 'string' ? (JSON.parse(mensagem) as { type: string }).type : null
      if (tipo === 'iniciar') ws.send(JSON.stringify({ type: 'pronta' }))
      if (tipo !== 'concluir') return
      ws.send(JSON.stringify({ type: 'final', frase: 0, falante: 'paciente', palavras: [{ texto: phrase, inicio_ms: 100, fim_ms: 2500 }], processado_ms: 2800 }))
      ws.send(JSON.stringify({ type: 'concluida' }))
    })
  })
  const copiloto = await simularCopiloto(page)
  const outraObra = title + ' não selecionado'
  await page.route('**/copiloto/api/consultar-qualificado', route => {
    const request = route.request().postDataJSON()
    expect(request.frase).toBe(phrase)
    expect(request.falante).toBe('paciente')
    expect(request.materialIds).toEqual([copiloto.preparados()[0]])
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({
      cartoes: [{ trecho_id: 'fonte-sintetica', titulo: title, autor: 'Autor sintético', pagina: 4, paragrafo: 2,
        citacao_literal: citation, fenomeno_na_fala: '', fenomeno_no_trecho: '', probabilidade: 0.95, nivel: 'forte' }],
      clarificar: false, alerta_risco: false, completo: true, juiz: 'v2',
    }) + '\n' })
  })
  const account = await registrarProfissionalNaInterface(page, request)
  await page.getByRole('link', { name: 'Acervo pessoal', exact: true }).click()
  await page.getByLabel('Arquivo do material', { exact: true }).setInputFiles({ name: 'referencia.txt', mimeType: 'text/plain', buffer: Buffer.from(citation) })
  await page.getByLabel('Título da obra', { exact: true }).fill(title)
  await page.getByLabel('Autores', { exact: true }).fill('Autor sintético')
  await page.getByRole('button', { name: 'Guardar no acervo', exact: true }).click()
  const material = page.locator('li.material-row').filter({ hasText: title })
  await expect(material.getByText('Pronto para selecionar na sessão', { exact: true })).toBeVisible()
  const autorizar = material.getByRole('checkbox', { name: 'Autorizar nas minhas consultas', exact: true })
  await autorizar.click()
  await expect(autorizar).toBeChecked()
  await page.getByLabel('Arquivo do material', { exact: true }).setInputFiles({ name: 'outra.txt', mimeType: 'text/plain', buffer: Buffer.from('Outra referência sintética não selecionada.') })
  await page.getByLabel('Título da obra', { exact: true }).fill(outraObra)
  await page.getByLabel('Autores', { exact: true }).fill('Outra autora')
  await page.getByRole('button', { name: 'Guardar no acervo', exact: true }).click()
  const outroMaterial = page.locator('li.material-row').filter({ hasText: outraObra })
  await expect(outroMaterial.getByText('Pronto para selecionar na sessão', { exact: true })).toBeVisible()
  await outroMaterial.getByRole('checkbox', { name: 'Autorizar nas minhas consultas', exact: true }).click()
  await expect(outroMaterial.getByRole('checkbox', { name: 'Autorizar nas minhas consultas', exact: true })).toBeChecked()
  await abrirConfiguracao(page, 'Identificação da sua voz')
  await page.getByRole('checkbox', { name: 'Autorizo o uso do microfone para cadastrar minha voz.' }).click()
  await page.getByRole('button', { name: 'Cadastrar minha voz', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Perfil de voz salvo. Ele será usado nas próximas sessões.' })).toBeVisible({ timeout: 90_000 })
  await abrirCarteira(page)
  const lista = page.getByRole('region', { name: 'Pacientes', exact: true })
  await lista.locator('details.patient-add > summary').click()
  await lista.getByLabel('Nome do paciente', { exact: true }).fill(name)
  await lista.getByRole('button', { name: 'Adicionar paciente', exact: true }).click()
  await lista.getByRole('link', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, level: 1, exact: true })).toBeVisible()
  await iniciarSessaoAgora(page)
  const consentimento = page.getByRole('region', { name: 'Consentimento e tipo de sessão', exact: true })
  await consentimento.getByRole('checkbox', { name: 'Paciente autorizou a gravação', exact: true }).click()
  await expect(consentimento.getByRole('checkbox', { name: 'Paciente autorizou a gravação', exact: true })).toBeChecked()
  await consentimento.getByRole('checkbox', { name: 'Paciente autorizou a análise por IA local', exact: true }).click()
  await expect(consentimento.getByRole('checkbox', { name: 'Paciente autorizou a análise por IA local', exact: true })).toBeChecked()
  const obras = page.getByRole('group', { name: 'Obras desta sessão', exact: true })
  await expect(obras.getByRole('checkbox', { name: title, exact: true })).toBeChecked()
  await obras.getByRole('checkbox', { name: outraObra, exact: true }).uncheck()
  const nota = page.getByRole('region', { name: 'Nota da sessão', exact: true })
  const sessao = page.getByRole('region', { name: 'Gravação e transcrição', exact: true })
  await sessao.getByLabel('Ou carregar áudio', { exact: true }).setInputFiles({ name: 'fixture-silencio.wav', mimeType: 'audio/wav', buffer: Buffer.from(codificarWav(new Float32Array(16000 * 3))) })
  await expect(sessao.getByRole('combobox', { name: 'Voz 1', exact: true })).toHaveValue('paciente')
  await expect(sessao.getByRole('button', { name: phrase, exact: true })).toBeVisible()
  await sessao.getByRole('button', { name: phrase, exact: true }).click()
  const escolher = sessao.getByRole('button', { name: 'Usar na nota', exact: true })
  await expect(escolher).toBeDisabled()
  await sessao.getByRole('checkbox', { name: 'Conferi o texto e quem falou cada trecho ouvindo o áudio.', exact: true }).click()
  await sessao.getByRole('button', { name: 'Salvar transcrição', exact: true }).click()
  await expect(sessao.getByText('Transcrição salva no prontuário. Somente texto, tempos e identificação das falas foram armazenados.', { exact: true })).toBeVisible()
  await expect(escolher).toBeEnabled()
  const before = mutations.length
  await escolher.click()
  const proposta = nota.getByRole('form', { name: 'Referência para aprovação', exact: true })
  await expect(proposta).toBeFocused()
  expect(mutations.length).toBe(before)
  await expect(nota.getByRole('textbox', { name: 'Avaliação 1', exact: true })).toHaveValue('')
  await proposta.getByRole('button', { name: 'Descartar referência', exact: true }).click()
  await expect(proposta).toHaveCount(0)
  await abrirAbaDaSessao(page, 'Insights')
  await escolher.click()
  await proposta.getByRole('button', { name: 'Confirmar referência na avaliação', exact: true }).click()
  await expect(proposta).toHaveCount(0)
  expect(mutations.length).toBe(before)
  await nota.getByRole('textbox', { name: 'Avaliação 2', exact: true }).fill('Avaliação escrita pelo profissional após consultar a referência sintética.')
  await nota.getByRole('button', { name: 'Assinar nota', exact: true }).click()
  await expect(nota.getByText('Nota assinada e salva no prontuário.', { exact: true })).toBeVisible()
  const reference = nota.locator('details').filter({ has: page.locator('summary', { hasText: title }) })
  await reference.locator('summary').click()
  await expect(reference.getByText(citation, { exact: true })).toBeVisible()
  await expect(reference.getByText('Autor sintético · Página 4, parágrafo 2', { exact: true })).toBeVisible()
  expect(mutations.join('')).not.toContain(name)
  expect(mutations.join('')).not.toContain(title)
  expect(mutations.join('')).not.toContain(phrase)
  expect(mutations.join('')).not.toContain(citation)
  expect((await axeBuilder(page).analyze()).violations).toEqual([])
  await page.setViewportSize({ width: 375, height: 812 })
  expect((await axeBuilder(page).analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: 'pt-BR' })
  try {
    const reopened = await context.newPage()
    reopened.on('pageerror', error => errors.push(error.message))
    await reopened.route('**/copiloto/api/acervo/**', route => route.fulfill({ json: { materials: copiloto.preparados().map((materialId, i) => ({ materialId, ready: true,
      sha256: createHash('sha256').update(i === 0 ? citation : 'Outra referência sintética não selecionada.').digest('hex'), paragraphs: 1 })) } }))
    await entrarProfissionalNaInterface(reopened, account)
    await abrirCarteira(reopened)
    await reopened.getByRole('region', { name: 'Pacientes', exact: true }).getByRole('link', { name, exact: true }).click()
    await expect(reopened.getByRole('heading', { name, level: 1, exact: true })).toBeVisible()
    await reopened.getByRole('link', { name: /^Sessão de / }).click()
    const obrasSalvas = reopened.getByRole('group', { name: 'Obras desta sessão', exact: true })
    await expect(obrasSalvas.getByRole('checkbox', { name: title, exact: true })).toBeChecked()
    await expect(obrasSalvas.getByRole('checkbox', { name: outraObra, exact: true })).not.toBeChecked()
    await abrirAbaDaSessao(reopened, 'Nota')
    const record = reopened.getByRole('region', { name: 'Nota da sessão', exact: true })
    const opened = record.locator('details').filter({ has: reopened.locator('summary', { hasText: title }) })
    await opened.locator('summary').click()
    await expect(opened.getByText(citation, { exact: true })).toBeVisible()
    await expect(record.getByRole('textbox', { name: 'Avaliação 2', exact: true })).toHaveAttribute('readonly', '')
    await opened.getByRole('button', { name: 'Ver fala da referência', exact: true }).click()
    await expect(reopened.getByRole('region', { name: 'Gravação e transcrição', exact: true }).getByText('Transcrição recuperada do prontuário. O áudio não é armazenado.', { exact: true })).toBeVisible()
    await expect(reopened.locator('button.transcript-insight')).toHaveCount(0)
  } finally { await context.close() }
  expect(errors).toEqual([])
})
