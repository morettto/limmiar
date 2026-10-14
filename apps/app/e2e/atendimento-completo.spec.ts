import { test, expect, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codificarWav } from '../../../packages/audio/src/wav'
import { API_BASE_URL } from '../playwright.config'
import { simularAsr } from './fixtures/atendimento/asr-simulado'
import { simularCopiloto, RESPOSTAS } from './fixtures/atendimento/copiloto-simulado'
import { modeloDeVozInstalado, servirModeloDeVoz } from './fixtures/modelo-de-voz'
import { pdfSintetico } from './fixtures/atendimento/pdf-sintetico'
import { Relatorio } from './fixtures/atendimento/relatorio'
import { FALAS_PACIENTE, indiceDaPalavra, montarAtendimento } from './fixtures/atendimento/roteiro'
import { abrirAbaDaSessao, abrirCarteira, abrirConfiguracao, entrarProfissionalNaInterface, SENHA_PROFISSIONAL_TESTE, voltarAoInicio, type ProfissionalTeste } from './fixtures/profissional-interface'
import { computeTotpCode } from './fixtures/totp'

// Plano de fechamento da V1, tarefa 18: o roteiro do §5 de ponta a ponta no stack local. O que a rede
// do app alcança sem serviço próprio (ASR e copiloto) é simulado; cada simulação está no relatório.

const atendimento = montarAtendimento()
const pasta = join(tmpdir(), 'limmiar-e2e-atendimento')
mkdirSync(pasta, { recursive: true })
const arquivoAudio = join(pasta, 'duas-vozes.wav')
writeFileSync(arquivoAudio, codificarWav(atendimento.audio))

// O Chromium repete o arquivo em laço; a captura começa em instantes diferentes dele, e por isso o
// ASR simulado se alinha pelo tom de sincronismo e não pelo relógio do teste.
test.use({
  locale: 'pt-BR',
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${arquivoAudio}`] },
})
test.setTimeout(480_000)
test.skip(!modeloDeVozInstalado(), 'Modelo de voz ausente: rode `node tools/voice-identity/setup.mjs`.')

const CLINICA = FALAS_PACIENTE[0]!
const NEGACAO = FALAS_PACIENTE[1]!
const RISCO = FALAS_PACIENTE[5]!
const SEM_CARTAO = FALAS_PACIENTE.filter((fala) => ['terceiro', 'neutra', 'figurada'].includes(fala.tipo))
const OBRA_A = RESPOSTAS.clinica.cartoes[0]!

function horarioLocal(minutosAFrente: number): string {
  const data = new Date(Date.now() + minutosAFrente * 60_000)
  const dois = (valor: number) => String(valor).padStart(2, '0')
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}T${dois(data.getHours())}:${dois(data.getMinutes())}`
}

async function abrirBalao(sessao: Locator, frase: string): Promise<Locator> {
  const fala = sessao.getByRole('button', { name: frase, exact: true })
  await fala.focus()
  await sessao.page().keyboard.press('Enter')
  const balao = sessao.locator('details.insight-balloon[open]').filter({ hasText: frase })
  await expect(balao).toBeVisible()
  await expect(balao.locator('summary').first()).toBeFocused()
  return balao
}

async function abrirPossiveis(balao: Locator): Promise<void> {
  const possiveis = balao.locator('details.insight-possiveis')
  if (!(await possiveis.evaluate((elemento) => (elemento as HTMLDetailsElement).open))) await possiveis.locator('> summary').click()
}

async function lerTrilha(page: Page): Promise<string[]> {
  await abrirConfiguracao(page, 'Trilha de auditoria')
  await expect(page.getByRole('status').filter({ hasText: 'Cadeia íntegra: nenhuma entrada foi alterada.' })).toBeVisible()
  return page.locator('tbody tr td:nth-child(2)').allTextContents()
}

test('atendimento completo: do cadastro à nota assinada, com microfone falso e duas vozes', async ({ page, request }) => {
  const relatorio = new Relatorio()
  relatorio.fronteira('Gateway de fala (WebSocket /speech, apps/gateway-fala + NeMo-Speech + TitaNet): simulado com page.routeWebSocket por um fake que fala o protocolo do gateway. Palavras e falantes vêm do roteiro; o áudio, a captura (AudioWorklet), o PCM16 enviado e o perfil de voz cifrado, aberto no aparelho e mandado na abertura, são reais.')
  relatorio.fronteira('Copiloto e juiz (/copiloto/api/acervo e /consultar-qualificado): simulados por page.route. O app monta os pedidos de verdade (só a fala do paciente, com o acervo autorizado); a resposta de cada tipo de fala é a que o juiz v2 deveria dar. Não mede a qualidade do juiz.')
  relatorio.fronteira('Aprovação do profissional: POST .../professional-verification/decision com a chave de staff do E2E, no lugar de `node tools/approve-local.mjs`. É o mesmo endpoint.')
  relatorio.fronteira('Microfone: dispositivo falso do Chromium tocando o WAV de duas vozes sintéticas. Um init script desliga cancelamento de eco, ganho automático e supressão de ruído, porque o zumbido sintético não é fala para esses filtros.')
  relatorio.fronteira('Modelo e worker de identidade de voz (TitaNet): os de produção, servidos por um servidor local do teste, porque o wrangler dev ignora /models/ e recusa arquivos acima de 25 MiB.')
  relatorio.fronteira('Tudo o mais é real: API .NET, Postgres, cifras e chaves no navegador, auditoria encadeada.')

  const erros: string[] = []
  const mutacoes: string[] = []
  page.on('pageerror', (erro) => erros.push(erro.message))
  page.on('console', (mensagem) => { if (mensagem.type() === 'error') relatorio.erroDoConsole(mensagem.text()) })
  page.on('request', (pedido) => { if (pedido.url().includes('/accounts/') && pedido.method() !== 'GET') mutacoes.push(pedido.postData() ?? '') })
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = (restricoes) =>
      original({ ...restricoes, audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false } })
  })
  const modelos = await servirModeloDeVoz(page)
  const asr = await simularAsr(page, atendimento)
  const copiloto = await simularCopiloto(page)

  const nomePaciente = `PACIENTE-SIMULADO-${randomUUID()}`
  const titulos = [`Obra sintética A ${randomUUID()}`, `Obra sintética B ${randomUUID()}`]
  const email = `atendimento-${randomUUID()}@example.com`
  let conta: ProfissionalTeste | undefined
  let contaId = ''
  let totalPalavras = 0
  const carteira = page.getByRole('region', { name: 'Pacientes', exact: true })
  const consentimento = page.getByRole('region', { name: 'Consentimento e tipo de sessão', exact: true })
  const nota = page.getByRole('region', { name: 'Nota da sessão', exact: true })
  const sessao = page.getByRole('region', { name: 'Gravação e transcrição', exact: true })
  const palavrasDaTela = () => sessao.getByRole('textbox', { name: /^Texto aos / })

  try {
    await relatorio.passo('1. Criar conta de profissional e configurar o TOTP', 'real', async () => {
      await page.goto('/')
      await page.getByLabel('E-mail', { exact: true }).fill(email)
      await page.getByLabel('Senha', { exact: true }).fill(SENHA_PROFISSIONAL_TESTE)
      const registro = page.waitForResponse((resposta) => resposta.url().endsWith('/auth/register') && resposta.request().method() === 'POST')
      await page.getByRole('button', { name: 'Criar conta', exact: true }).click()
      const registrada = await registro
      expect(registrada.ok()).toBe(true)
      contaId = ((await registrada.json()) as { id: string }).id
      const segredo = await page.getByLabel('Código secreto', { exact: true }).inputValue()
      expect(segredo).not.toBe('')
      await page.getByLabel('Código de 6 dígitos do aplicativo autenticador', { exact: true }).fill(computeTotpCode(segredo, Math.floor(Date.now() / 1000)))
      await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Guarde seus códigos de backup' })).toBeVisible()
      relatorio.medida('Códigos de backup do TOTP exibidos', String(await page.getByRole('listitem').count()))
      await page.getByRole('button', { name: 'Guardei meus códigos', exact: true }).click()
      await expect(page.locator('#app-shell')).toBeVisible()
      conta = { email, secret: segredo }
    })

    await relatorio.passo('1b. Anotar a frase de recuperação', 'real', async () => {
      await abrirConfiguracao(page, 'Frase de recuperação')
      await page.getByLabel('Senha atual', { exact: true }).fill(SENHA_PROFISSIONAL_TESTE)
      await page.getByRole('button', { name: 'Gerar frase de recuperação', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Guarde sua frase de recuperação' })).toBeVisible()
      relatorio.medida('Palavras da frase de recuperação exibidas', String(await page.getByRole('listitem').count()))
      await page.getByRole('button', { name: 'Guardei minha frase', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Frase de recuperação salva.' })).toBeVisible()
      await page.goBack()
      await expect(page.locator('#app-shell')).toBeVisible()
    })

    await relatorio.passo('2. Enviar a referência do documento, aprovar e atualizar a verificação', 'real', async () => {
      await page.getByLabel('Referência do documento', { exact: true }).fill('Documento fictício do atendimento simulado')
      await page.getByRole('button', { name: 'Enviar para revisão', exact: true }).click()
      await expect(page.getByText('Documento recebido. Sua conta aguarda a aprovação da equipe.', { exact: true })).toBeVisible()
      const decisao = await request.post(`${API_BASE_URL}/accounts/${contaId}/professional-verification/decision`, {
        headers: { 'X-Staff-Api-Key': process.env.LIMMIAR_E2E_STAFF_API_KEY ?? 'e2e-unused-staff-key' }, data: { approved: true, rejectionReason: null },
      })
      expect(decisao.ok()).toBe(true)
      await page.getByRole('button', { name: 'Atualizar verificação', exact: true }).click()
      await expect(page.getByRole('region', { name: 'Painel do consultório', exact: true })).toBeVisible()
    })

    await relatorio.passo('3. Acervo: guardar 2 PDFs, autorizar o uso e esperar "pronto"', 'simulado', async () => {
      await page.getByRole('link', { name: 'Acervo pessoal', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Seu acervo', exact: true })).toBeVisible()
      for (const [indice, titulo] of titulos.entries()) {
        await page.getByLabel('Arquivo do material', { exact: true }).setInputFiles({ name: `obra-${indice}.pdf`, mimeType: 'application/pdf', buffer: pdfSintetico(titulo) })
        await page.getByLabel('Título da obra', { exact: true }).fill(titulo)
        await page.getByLabel('Autores', { exact: true }).fill(`Autor Sintético ${indice === 0 ? 'A' : 'B'}`)
        await page.getByRole('button', { name: 'Guardar no acervo', exact: true }).click()
        await expect(page.getByRole('status').filter({ hasText: 'Material guardado.' })).toBeVisible()
        const linha = page.locator('li.material-row').filter({ hasText: titulo })
        await expect(linha.getByRole('progressbar', { name: 'Avanço da preparação' })).toBeVisible()
        if (indice === 0) await page.screenshot({ path: test.info().outputPath('acervo-progress.png'), fullPage: true })
        await linha.getByRole('checkbox', { name: 'Autorizar nas minhas consultas', exact: true }).click()
        await expect(linha.getByText('Pronto para selecionar na sessão', { exact: true })).toBeVisible()
      }
      expect(copiloto.preparados()).toHaveLength(2)
      await voltarAoInicio(page)
      await expect(page.locator('#app-shell')).toBeVisible()
    })

    await relatorio.passo('4. Cadastrar a voz do profissional (15 s)', 'real', async () => {
      await abrirConfiguracao(page, 'Identificação da sua voz')
      await page.getByRole('checkbox', { name: 'Autorizo o uso do microfone para cadastrar minha voz.' }).click()
      await page.getByRole('button', { name: 'Cadastrar minha voz', exact: true }).click()
      const resultado = page.getByRole('status').filter({ hasText: /Perfil de voz salvo|Não foi possível cadastrar/ })
      await expect(resultado).toBeVisible({ timeout: 90_000 })
      await expect(resultado).toHaveText('Perfil de voz salvo. Ele será usado nas próximas sessões.')
      await voltarAoInicio(page)
      await expect(page.locator('#app-shell')).toBeVisible()
    })

    await relatorio.passo('5. Criar paciente fictício, agendar a sessão de hoje, abrir pelo painel e iniciar a sessão da pasta', 'real', async () => {
      await abrirCarteira(page)
      await carteira.locator('details.patient-add > summary').click()
      await carteira.getByLabel('Nome do paciente', { exact: true }).fill(nomePaciente)
      await carteira.getByRole('button', { name: 'Adicionar paciente', exact: true }).click()
      await carteira.getByRole('link', { name: nomePaciente, exact: true }).click()
      const agenda = page.getByRole('region', { name: 'Agenda deste paciente', exact: true })
      await agenda.getByLabel('Data e horário', { exact: true }).fill(horarioLocal(15))
      await agenda.getByRole('button', { name: 'Agendar sessão', exact: true }).click()
      await expect(agenda.getByRole('status').filter({ hasText: 'Sessão agendada.' })).toBeVisible()
      await voltarAoInicio(page)
      const iniciar = page.getByRole('region', { name: 'Painel do consultório', exact: true }).getByRole('button', { name: new RegExp(`Iniciar próxima: ${nomePaciente}`) })
      await expect(iniciar).toBeEnabled()
      await iniciar.click()
      await expect(page.getByRole('heading', { name: nomePaciente, level: 1, exact: true })).toBeVisible()
      const iniciarSessao = page.getByRole('region', { name: 'Hoje', exact: true }).getByRole('button', { name: 'Iniciar sessão', exact: true })
      await expect(iniciarSessao).toBeFocused()
      await iniciarSessao.click()
      await expect(page.getByRole('heading', { name: /^Sessão de /, level: 1 })).toBeVisible()
    })

    await relatorio.passo('6. Registrar os consentimentos de gravação e de análise por IA', 'real', async () => {
      await consentimento.getByRole('checkbox', { name: 'Paciente autorizou a gravação', exact: true }).click()
      await expect(consentimento.getByRole('checkbox', { name: 'Paciente autorizou a gravação', exact: true })).toBeChecked()
      await consentimento.getByRole('checkbox', { name: 'Paciente autorizou a análise por IA local', exact: true }).click()
      await expect(consentimento.getByRole('checkbox', { name: 'Paciente autorizou a análise por IA local', exact: true })).toBeChecked()
      await expect(sessao.getByText('Preparando seu acervo autorizado para o copiloto local...')).toHaveCount(0)
    })

    let cartaoClinicoEm = Promise.resolve(0)
    await relatorio.passo('7. Iniciar a captura e falar as seis frases (duas vozes no WAV)', 'simulado', async () => {
      await sessao.getByRole('button', { name: 'Iniciar gravação', exact: true }).click()
      cartaoClinicoEm = sessao.getByRole('button', { name: CLINICA.texto, exact: true }).waitFor({ timeout: 150_000 }).then(() => Date.now(), () => 0)
      await expect(sessao.getByRole('status').filter({ hasText: 'Transcrição ao vivo. Seu perfil de voz identifica' }),
        'A captura não abriu. Confira o fake do servidor em e2e/fixtures/atendimento/asr-simulado.ts contra shared/audio/transcricao-servidor.ts e apps/gateway-fala/src/protocolo.ts.').toBeVisible()
      await expect(sessao.getByRole('button', { name: 'Encerrar gravação', exact: true })).toBeVisible()
      for (const fala of FALAS_PACIENTE) {
        await expect(sessao.locator('li.transcript-block').filter({ hasText: fala.ouvido ?? fala.texto })).toBeVisible({ timeout: 150_000 })
      }
      expect(await asr.sessoes()).toBe(1)
    })

    await relatorio.passo('8. Papéis das vozes identificados pelo perfil, cartões forte e possível com autor, página e citação', 'simulado', async () => {
      const vozes = sessao.getByRole('combobox', { name: /^Voz [12]$/ })
      await expect.poll(async () => (await vozes.evaluateAll((selects) => selects.map((select) => (select as HTMLSelectElement).value))).sort(), { timeout: 60_000 })
        .toEqual(['paciente', 'voce'])
      const fala = sessao.getByRole('button', { name: CLINICA.texto, exact: true })
      await expect(fala).toBeVisible()
      const visivelEm = await cartaoClinicoEm
      expect(visivelEm).toBeGreaterThan(0)
      relatorio.medida('Última palavra da fala clínica até o cartão visível (transcrição, identificação de quem fala e juiz simulados)', `${((visivelEm - (await asr.reveladas())[CLINICA.texto]!) / 1000).toFixed(1)} s`)
      await expect(fala).toHaveCSS('text-decoration-style', 'dashed')
      await expect(sessao.getByRole('button', { name: NEGACAO.texto, exact: true })).toHaveCSS('text-decoration-style', 'dotted')

      const balao = await abrirBalao(sessao, CLINICA.texto)
      const fortes = balao.locator(':scope > .insight-source')
      await expect(fortes).toHaveCount(2)
      await expect(fortes.first().getByText(`${OBRA_A.titulo} — ${OBRA_A.autor}`, { exact: true })).toBeVisible()
      await expect(fortes.first().getByText(`Página ${OBRA_A.pagina}, parágrafo ${OBRA_A.paragrafo}`, { exact: true })).toBeVisible()
      await expect(fortes.first().locator('blockquote')).toHaveText(OBRA_A.citacao_literal)
      await abrirPossiveis(balao)
      await expect(balao.locator('details.insight-possiveis .insight-source')).toHaveCount(2)

      for (const semCartao of SEM_CARTAO) {
        await expect(sessao.locator('li.transcript-block').filter({ hasText: semCartao.ouvido ?? semCartao.texto })).toBeVisible()
        await expect(sessao.getByRole('button', { name: semCartao.ouvido ?? semCartao.texto, exact: true })).toHaveCount(0)
      }
      const risco = await abrirBalao(sessao, RISCO.texto)
      await expect(risco.getByText('Avalie esta fala no contexto do atendimento.', { exact: true })).toBeVisible()
    })

    await relatorio.passo('9. Votar útil e não útil em 5 cartões, mantendo os votos só no aparelho', 'simulado', async () => {
      const balao = await abrirBalao(sessao, CLINICA.texto)
      await abrirPossiveis(balao)
      const cartoes = balao.locator('.insight-source')
      const votos: [number, string][] = [[0, 'Útil'], [1, 'Não útil'], [2, 'Útil'], [3, 'Não útil']]
      for (const [indice, voto] of votos) {
        await cartoes.nth(indice).getByRole('button', { name: voto, exact: true }).click()
        if (indice === 0) await sessao.getByRole('group', { name: 'Enviar seus votos' }).getByRole('button', { name: 'Só neste aparelho', exact: true }).click()
        await expect(cartoes.nth(indice).getByRole('button', { name: voto, exact: true })).toHaveAttribute('aria-pressed', 'true')
      }
      const negacao = await abrirBalao(sessao, NEGACAO.texto)
      await abrirPossiveis(negacao)
      await negacao.getByRole('button', { name: 'Útil', exact: true }).click()
      await expect(negacao.getByRole('button', { name: 'Útil', exact: true })).toHaveAttribute('aria-pressed', 'true')
      expect(copiloto.votosEnviados).toEqual([])
    })

    await relatorio.passo('10. Pausar, retomar e encerrar a gravação', 'simulado', async () => {
      await sessao.getByRole('button', { name: 'Pausar sessão', exact: true }).click()
      await expect(sessao.getByText('Microfone pausado.', { exact: true })).toBeVisible()
      await sessao.getByRole('button', { name: 'Retomar sessão', exact: true }).click()
      await expect(sessao.getByText('O áudio permanece somente em memória durante a sessão.', { exact: true })).toBeVisible()
      await sessao.getByRole('button', { name: 'Encerrar gravação', exact: true }).click()
      await expect(sessao.getByRole('status').filter({ hasText: 'Transcrição concluída. Confirme os papéis das vozes.' })).toBeVisible({ timeout: 60_000 })
    })

    await relatorio.passo('11. Revisar a transcrição, corrigir uma palavra e salvar', 'real', async () => {
      await sessao.getByText('Corrigir texto e voz por palavra', { exact: true }).click()
      totalPalavras = await palavrasDaTela().count()
      const indice = indiceDaPalavra(atendimento, 'onibus')
      await expect(palavrasDaTela().nth(indice)).toHaveValue('onibus')
      await palavrasDaTela().nth(indice).fill('ônibus')
      await expect.poll(() => copiloto.consultas.some((consulta) => consulta.frase === 'Vim de ônibus hoje, o trânsito estava tranquilo.'), { timeout: 30_000 }).toBe(true)
      await sessao.getByRole('checkbox', { name: 'Conferi o texto e quem falou cada trecho ouvindo o áudio.', exact: true }).check()
      await sessao.getByRole('button', { name: 'Salvar transcrição', exact: true }).click()
      await expect(sessao.getByText('Transcrição salva no prontuário. Somente texto, tempos e identificação das falas foram armazenados.', { exact: true })).toBeVisible()
    })

    await relatorio.passo('12. Escolher a referência, escrever a nota SOAP e assinar', 'real', async () => {
      const balao = await abrirBalao(sessao, CLINICA.texto)
      await balao.locator(':scope > .insight-source').first().getByRole('button', { name: 'Usar na nota', exact: true }).click()
      const proposta = nota.getByRole('form', { name: 'Referência para aprovação', exact: true })
      await expect(proposta).toBeFocused()
      await proposta.getByRole('button', { name: 'Confirmar referência na avaliação', exact: true }).click()
      await nota.getByRole('textbox', { name: 'Subjetivo 1', exact: true }).fill('Paciente relata evitação de dirigir desde o acidente.')
      await nota.getByRole('textbox', { name: 'Avaliação 2', exact: true }).fill('Avaliação do profissional após consultar a referência sintética.')
      await nota.getByRole('button', { name: 'Assinar nota', exact: true }).click()
      await expect(nota.getByText('Nota assinada e salva no prontuário.', { exact: true })).toBeVisible()
    })

    await relatorio.passo('13. Auditoria: entradas e cadeia íntegra', 'real', async () => {
      await page.getByRole('button', { name: 'Encerrar sessão', exact: true }).click()
      await expect(page.getByText('Sessão encerrada', { exact: true })).toBeVisible()
      await voltarAoInicio(page)
      const acoes = await lerTrilha(page)
      for (const esperada of ['Entrada na conta', 'Prontuário aberto', 'Registro acrescentado ao prontuário', 'Nota assinada']) expect(acoes).toContain(esperada)
      await voltarAoInicio(page)
    })

    await relatorio.passo('14. Sair', 'real', async () => {
      await page.getByRole('button', { name: 'Sair', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Bem-vindo ao Limmiar' })).toBeVisible()
      expect(await page.evaluate(() => window.sessionStorage.length)).toBe(0)
    })

    await relatorio.passo('15. Entrar de novo com TOTP e reabrir nota, transcrição e referência', 'real', async () => {
      await entrarProfissionalNaInterface(page, conta!)
      await abrirCarteira(page)
      await carteira.getByRole('link', { name: nomePaciente, exact: true }).click()
      await page.getByRole('link', { name: /^Sessão de / }).click()
      await expect(page.getByText('Sessão encerrada', { exact: true })).toBeVisible()
      await abrirAbaDaSessao(page, 'Nota')
      const referencia = nota.locator('details').filter({ has: page.locator('summary', { hasText: OBRA_A.titulo }) })
      await referencia.locator('summary').click()
      await expect(referencia.getByText(OBRA_A.citacao_literal, { exact: true })).toBeVisible()
      await expect(referencia.getByText(`${OBRA_A.autor} · Página ${OBRA_A.pagina}, parágrafo ${OBRA_A.paragrafo}`, { exact: true })).toBeVisible()
      await expect(nota.getByRole('textbox', { name: 'Avaliação 2', exact: true })).toHaveAttribute('readonly', '')
      await referencia.getByRole('button', { name: 'Ver fala da referência', exact: true }).click()
      await expect(sessao.getByText('Transcrição recuperada do prontuário. O áudio não é armazenado.', { exact: true })).toBeVisible()
      await sessao.getByText('Corrigir texto e voz por palavra', { exact: true }).click()
      await expect(palavrasDaTela()).toHaveCount(totalPalavras)
      await expect(palavrasDaTela().nth(indiceDaPalavra(atendimento, 'onibus'))).toHaveValue('ônibus')
      relatorio.medida('Palavras da transcrição antes de sair e depois de entrar', `${totalPalavras} e ${await palavrasDaTela().count()}`)
      await voltarAoInicio(page)
      const acoes = await lerTrilha(page)
      expect(acoes).toContain('Saída da conta')
      expect(acoes.filter((acao) => acao === 'Entrada na conta').length).toBeGreaterThanOrEqual(2)
    })

    await relatorio.passo('16. Conferir o que cada fronteira recebeu', 'real', async () => {
      const analisadas = copiloto.consultas.map((consulta) => consulta.frase)
      for (const fala of FALAS_PACIENTE) expect(analisadas).toContain(fala.texto)
      expect(copiloto.consultas.every((consulta) => consulta.falante === 'paciente' && consulta.comAutorizacao)).toBe(true)
      expect(copiloto.consultas.every((consulta) => consulta.materialIds.length === 2)).toBe(true)
      expect(analisadas.some((frase) => atendimento.enunciados.some((e) => e.quem === 'profissional' && frase.includes(e.texto)))).toBe(false)
      const enviado = mutacoes.join('')
      for (const segredo of [nomePaciente, CLINICA.texto, OBRA_A.citacao_literal, ...titulos]) expect(enviado).not.toContain(segredo)
      expect(erros).toEqual([])
      relatorio.medida('Consultas ao juiz simulado', String(copiloto.consultas.length))
      relatorio.medida('Cartões marcados como "dúvida"', 'a tela não tem essa marcação, só "Útil" e "Não útil"; no teste manual, anote à mão')
    })
  } finally {
    modelos.close()
    const arquivo = await relatorio.salvar(test.info())
    console.log(`Relatório do atendimento simulado: ${arquivo}`)
  }
})
