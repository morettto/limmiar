import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { codificarWav } from '../../../packages/audio/src/wav'
import { modeloDeVozInstalado, servirModeloDeVoz } from './fixtures/modelo-de-voz'
import { simularCopiloto } from './fixtures/atendimento/copiloto-simulado'
import { abrirAbaDaSessao, abrirCarteira, abrirConfiguracao, iniciarSessaoAgora, registrarProfissionalNaInterface, entrarProfissionalNaInterface } from './fixtures/profissional-interface'

const arquivo = join(tmpdir(), `limmiar-e2e-regressoes-voz-${process.pid}.wav`)
const bytesVoz = readFileSync(new URL('../../gateway-fala/src/fixtures/maria-3s.pcm', import.meta.url))
const voz = new Int16Array(bytesVoz.buffer, bytesVoz.byteOffset, bytesVoz.byteLength / 2)
const amostras = Float32Array.from({ length: 16000 * 20 }, (_, i) => voz[i % voz.length]! / 32768)
writeFileSync(arquivo, Buffer.from(codificarWav(amostras)))
test.use({ locale: 'pt-BR', permissions: ['microphone'], launchOptions: { args: [
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${arquivo}`,
] } })

async function abrirPaciente(page: Page, nome: string) {
  await abrirCarteira(page)
  const lista = page.getByRole('region', { name: 'Pacientes', exact: true })
  await lista.locator('details.patient-add > summary').click()
  await lista.getByLabel('Nome do paciente', { exact: true }).fill(nome)
  await lista.getByRole('button', { name: 'Adicionar paciente', exact: true }).click()
  await lista.getByRole('link', { name: nome, exact: true }).click()
  await iniciarSessaoAgora(page)
}

test('sem obras autorizadas orienta o profissional e não consulta o juiz', async ({ page, request }) => {
  test.setTimeout(90_000)
  test.skip(!modeloDeVozInstalado(), 'Modelo necessário para cadastrar voz antes de transcrever.')
  await servirModeloDeVoz(page)
  const copiloto = await simularCopiloto(page)
  const frase = 'Fala sintética do paciente sem obras autorizadas.'
  await page.routeWebSocket(/\/speech\/v1\/fala$/, ws => ws.onMessage(mensagem => {
    if (typeof mensagem !== 'string') return
    const { type } = JSON.parse(mensagem)
    if (type === 'iniciar') ws.send(JSON.stringify({ type: 'pronta' }))
    if (type === 'concluir') {
      ws.send(JSON.stringify({ type: 'final', frase: 0, falante: 'paciente', palavras: [{ texto: frase, inicio_ms: 100, fim_ms: 2500 }], processado_ms: 2800 }))
      ws.send(JSON.stringify({ type: 'concluida' }))
    }
  }))
  await registrarProfissionalNaInterface(page, request)
  await abrirConfiguracao(page, 'Identificação da sua voz')
  await page.getByRole('checkbox', { name: 'Autorizo o uso do microfone para cadastrar minha voz.' }).check()
  await page.getByRole('button', { name: 'Cadastrar minha voz', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Perfil de voz salvo. Ele será usado nas próximas sessões.' })).toBeVisible({ timeout: 90_000 })
  await abrirPaciente(page, 'Acervo vazio ' + randomUUID())
  await page.getByRole('checkbox', { name: 'Paciente autorizou a análise por IA local', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Autorize materiais no acervo para receber referências durante a sessão.', exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Paciente autorizou a gravação', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Paciente autorizou a gravação', exact: true })).toBeChecked()
  const sessao = page.getByRole('region', { name: 'Gravação e transcrição', exact: true })
  await sessao.getByLabel('Ou carregar áudio', { exact: true }).setInputFiles({ name: 'fala.wav', mimeType: 'audio/wav', buffer: Buffer.from(codificarWav(amostras.slice(0, 48000))) })
  await expect(sessao.locator('li.transcript-block').filter({ hasText: frase })).toBeVisible()
  // Cobre o debounce do copiloto mesmo quando nenhuma consulta deveria ser enviada.
  await page.waitForTimeout(1000)
  expect(copiloto.consultas).toEqual([])
})

test('abertura conserva PCM, distingue vozes e silêncio; encerramento exige revisão e preserva rascunho cifrado', async ({ page, request }) => {
  test.setTimeout(180_000)
  test.skip(!modeloDeVozInstalado(), 'Modelo público TitaNet necessário para cadastro real do perfil.')
  await servirModeloDeVoz(page)
  const copiloto = await simularCopiloto(page)
  const nome = 'Paciente de regressão ' + randomUUID()
  const titulo = 'Livro de regressão ' + randomUUID()
  const textoPaciente = 'Tenho medo quando lembro desta situação sintética.'
  const textoProfissional = 'Entendi perfeitamente o seu relato sintético.'
  const textoVisita = 'Outra pessoa faz uma observação sintética privada.'
  const rascunho = 'Rascunho sintético deve permanecer editável depois de encerrar.'
  const escritas: string[] = []
  page.on('request', pedido => {
    if (pedido.url().includes('/accounts/') && pedido.method() !== 'GET') escritas.push(pedido.postData() ?? '')
  })
  let prontaEm = 0, quadrosIniciais = 0, recebidas = 0
  // ASR/identidades são controlados aqui; cadastro, microfone, PCM, armazenamento e notas são reais.
  await page.routeWebSocket(/\/speech\/v1\/fala$/, ws => {
    ws.onMessage(mensagem => {
      if (typeof mensagem === 'string') {
        const { type } = JSON.parse(mensagem)
        if (type === 'iniciar') setTimeout(() => { prontaEm = Date.now(); ws.send(JSON.stringify({ type: 'pronta' })) }, 2000)
        if (type === 'concluir') ws.send(JSON.stringify({ type: 'concluida' }))
        return
      }
      if (Date.now() - prontaEm < 100) quadrosIniciais++
      if (recebidas++ > 0) return
      const finais = [
        ['profissional', textoProfissional, 100, 1100],
        ['paciente', textoPaciente, 2000, 7000],
        ['paciente', 'Também relato outra preocupação sintética nesta consulta.', 82000, 87000],
        ['pessoa_4', textoVisita, 90000, 91000],
        [null, 'Trecho ainda sem voz identificada.', 92000, 93000],
      ] as const
      finais.forEach(([falante, texto, inicio_ms, fim_ms], frase) => ws.send(JSON.stringify({ type: 'final', frase, falante,
        palavras: [{ texto, inicio_ms, fim_ms }], processado_ms: 94000 })))
    })
  })
  const conta = await registrarProfissionalNaInterface(page, request)
  await page.getByRole('link', { name: 'Acervo pessoal', exact: true }).click()
  await page.getByLabel('Arquivo do material', { exact: true }).setInputFiles({ name: 'regressao.txt', mimeType: 'text/plain', buffer: Buffer.from('Referência sintética para regressão.') })
  await page.getByLabel('Título da obra', { exact: true }).fill(titulo)
  await page.getByLabel('Autores', { exact: true }).fill('Autora sintética')
  await page.getByRole('button', { name: 'Guardar no acervo', exact: true }).click()
  const material = page.locator('li.material-row').filter({ hasText: titulo })
  await expect(material.getByText('Pronto para selecionar na sessão', { exact: true })).toBeVisible()
  await material.getByRole('checkbox').click()
  await expect(material.getByRole('checkbox')).toBeChecked()
  await abrirConfiguracao(page, 'Identificação da sua voz')
  await page.getByRole('checkbox', { name: 'Autorizo o uso do microfone para cadastrar minha voz.' }).check()
  await page.getByRole('button', { name: 'Cadastrar minha voz', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Perfil de voz salvo. Ele será usado nas próximas sessões.' })).toBeVisible({ timeout: 90_000 })
  await abrirPaciente(page, nome)
  const urlSessao = page.url()
  const consentimento = page.getByRole('region', { name: 'Consentimento e tipo de sessão', exact: true })
  await consentimento.getByRole('checkbox', { name: 'Paciente autorizou a gravação', exact: true }).click()
  await consentimento.getByRole('checkbox', { name: 'Paciente autorizou a análise por IA local', exact: true }).click()
  await expect(consentimento.getByRole('checkbox', { name: 'Paciente autorizou a análise por IA local', exact: true })).toBeChecked()
  const sessao = page.getByRole('region', { name: 'Gravação e transcrição', exact: true })
  await expect(sessao.getByRole('group', { name: 'Obras desta sessão', exact: true }).getByRole('checkbox')).toBeChecked()
  await sessao.getByRole('button', { name: 'Iniciar gravação', exact: true }).click()
  await expect(sessao.locator('li.transcript-block').filter({ hasText: textoPaciente }).locator('strong')).toHaveText('Paciente')
  await expect(sessao.locator('li.transcript-block').filter({ hasText: textoVisita }).locator('strong')).toHaveText('Pessoa 4')
  await expect(sessao.getByText('Voz não identificada', { exact: true })).toBeVisible()
  await expect(sessao.locator('li.transcript-block').filter({ hasText: textoPaciente }).getByText('Tempo de fala: 0:10', { exact: true })).toBeVisible()
  await expect.poll(() => quadrosIniciais).toBeGreaterThan(5)
  await expect.poll(() => copiloto.consultas.length).toBeGreaterThan(0)
  expect(copiloto.consultas.every(c => c.falante === 'paciente' && !c.frase.includes(textoProfissional) && !c.frase.includes(textoVisita))).toBe(true)
  await page.getByRole('button', { name: 'Encerrar sessão', exact: true }).click()
  await expect(page.getByText('Captura encerrada. Confira e salve a transcrição antes de encerrar a sessão.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Encerrar sessão', exact: true })).toBeVisible()
  await expect(sessao.getByRole('button', { name: 'Salvar transcrição', exact: true })).toBeDisabled()
  await sessao.getByText('Corrigir texto e voz por palavra', { exact: true }).click()
  const vozesPorPalavra = sessao.locator('details select')
  await vozesPorPalavra.nth(3).selectOption('profissional')
  await vozesPorPalavra.nth(4).selectOption('profissional')
  await sessao.getByRole('checkbox', { name: 'Conferi o texto e quem falou cada trecho ouvindo o áudio.', exact: true }).check()
  await sessao.getByRole('button', { name: 'Salvar transcrição', exact: true }).click()
  await expect(sessao.getByText('Transcrição salva no prontuário. Somente texto, tempos e identificação das falas foram armazenados.', { exact: true })).toBeVisible()
  const ouvir = sessao.locator('li.transcript-block').filter({ hasText: textoPaciente }).getByRole('button', { name: /^Ouvir trecho aos / })
  const inicio = Number(/aos ([\d.]+)s/.exec((await ouvir.getAttribute('aria-label'))!)![1])
  await ouvir.click()
  await expect.poll(() => sessao.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(inicio)
  await abrirAbaDaSessao(page, 'Nota')
  const nota = page.getByRole('region', { name: 'Nota da sessão', exact: true })
  await nota.getByRole('textbox', { name: 'Subjetivo 1', exact: true }).fill(rascunho)
  let falha = true
  await page.route('**/accounts/*/patients/*/entries', route => {
    if (route.request().method() === 'POST' && falha) { falha = false; return route.fulfill({ status: 503, json: {} }) }
    return route.continue()
  })
  await page.getByRole('button', { name: 'Encerrar sessão', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Encerrar sessão', exact: true })).toBeEnabled()
  await expect(page.getByText('Sessão encerrada', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Encerrar sessão', exact: true }).click()
  await expect(page.getByText('Sessão encerrada', { exact: true })).toBeVisible()
  await expect(nota.getByRole('textbox', { name: 'Subjetivo 1', exact: true })).not.toHaveAttribute('readonly')
  await expect(nota.getByRole('button', { name: 'Assinar nota', exact: true })).toBeEnabled()
  await page.reload()
  await entrarProfissionalNaInterface(page, conta)
  await abrirCarteira(page)
  await page.getByRole('region', { name: 'Pacientes', exact: true }).getByRole('link', { name: nome, exact: true }).click()
  await page.getByRole('region', { name: 'Sessões do paciente', exact: true }).getByRole('link', { name: /^Sessão de / }).click()
  await expect(page.getByText('Sessão encerrada', { exact: true })).toBeVisible()
  await abrirAbaDaSessao(page, 'Nota')
  await expect(page.getByRole('textbox', { name: 'Subjetivo 1', exact: true })).toHaveValue(rascunho)
  await expect(page.getByRole('textbox', { name: 'Subjetivo 1', exact: true })).not.toHaveAttribute('readonly')
  const privado = escritas.join('')
  for (const texto of [nome, titulo, textoPaciente, textoVisita, rascunho]) expect(privado).not.toContain(texto)
  await page.getByRole('navigation', { name: 'Você está em', exact: true }).getByRole('link', { name: nome, exact: true }).click()
  const historico = page.getByRole('region', { name: 'Sessões do paciente', exact: true })
  await expect(historico.locator('li').first()).toContainText('Sessão encerrada')
  const layout = await historico.evaluate(elemento => {
    const linha = elemento.querySelector('li')!
    const link = linha.querySelector('a')!
    const anterior = elemento.previousElementSibling!
    return { altura: link.getBoundingClientRect().height, fonte: Number.parseFloat(getComputedStyle(link).fontSize),
      borda: getComputedStyle(linha).borderTopWidth, espaco: elemento.getBoundingClientRect().top - anterior.getBoundingClientRect().bottom }
  })
  expect(layout.altura).toBeGreaterThanOrEqual(44)
  expect(layout.fonte).toBeGreaterThanOrEqual(18)
  expect(layout.borda).not.toBe('0px')
  expect(layout.espaco).toBeGreaterThanOrEqual(16)
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const link = historico.getByRole('link', { name: /^Sessão de / })
  await link.focus(); await page.keyboard.press('Enter')
  await expect(page).toHaveURL(urlSessao)
  await expect(page.getByText('Sessão encerrada', { exact: true })).toBeVisible()
})
