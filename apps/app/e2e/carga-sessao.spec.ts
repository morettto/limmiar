import { test, expect, type Request } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { simularAsr } from './fixtures/atendimento/asr-simulado'
import { planoDaCarga, SAIDA } from './fixtures/atendimento/carga-plano'
import { rotearCopiloto, type Consulta } from './fixtures/atendimento/copiloto-real'
import { montarAtendimentoDe } from './fixtures/atendimento/roteiro'
import { servirModeloDeVoz } from './fixtures/modelo-de-voz'
import { abrirCarteira, entrarProfissionalNaInterface, iniciarSessaoAgora, voltarAoInicio, type ProfissionalTeste } from './fixtures/profissional-interface'

// Uma sessão da carga com o copiloto real (playwright.carga.config.ts): o profissional do tema entra com TOTP, cria o
// paciente, abre a sessão, registra os consentimentos e grava o diálogo do cenário (microfone falso com o WAV do
// projeto; transcrição pelo simulador do protocolo). Grava as consultas, o fim de cada frase e cada cartão na tela.

interface MarcaNaTela { id: string; frase: string; emMs: number; naJanela: boolean }
interface Resposta { cartoes?: { trecho_id: string }[]; clarificar?: boolean; alerta_risco?: boolean; erro?: string }

const plano = planoDaCarga()

test('sessão da carga com o copiloto real', async ({ page }, info) => {
  const sessaoPlano = plano.sessoes.find((s) => s.id === info.project.metadata.sessao)!
  const profissional = plano.profissionais.find((p) => p.tema === sessaoPlano.tema)!
  const escolhidas = [0, 1, 2].map((k) => profissional.obras[(sessaoPlano.ordem + k) % profissional.obras.length]!.pmcid)
  const atendimento = montarAtendimentoDe(sessaoPlano.turnos)
  const conta = JSON.parse(readFileSync(join(SAIDA, `conta-${sessaoPlano.tema}.json`), 'utf8')) as ProfissionalTeste
  const erros: string[] = []
  page.on('pageerror', (erro) => erros.push(erro.message))
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = (restricoes) =>
      original({ ...restricoes, audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false } })
  })
  await page.addInitScript(() => {
    const marcas: MarcaNaTela[] = []
    Object.assign(window, { __insightsNaTela: marcas })
    let presentes = new Set<string>()
    let quadroPendente = false
    // A mutação ainda não está na tela: o primeiro instante visível é o próximo quadro de animação.
    new MutationObserver(() => {
      if (quadroPendente) return
      quadroPendente = true
      requestAnimationFrame(() => {
        quadroPendente = false
        const emMs = performance.timeOrigin + performance.now()
        const agora = new Set<string>()
        for (const botao of document.querySelectorAll<HTMLElement>('button.transcript-insight[data-consulta-id]')) {
          const id = botao.dataset.consultaId!
          if (agora.has(id)) continue
          agora.add(id)
          if (presentes.has(id)) continue
          const caixa = botao.getBoundingClientRect()
          marcas.push({ id, frase: botao.textContent ?? '', emMs,
            naJanela: caixa.bottom > 0 && caixa.top < innerHeight && caixa.right > 0 && caixa.left < innerWidth })
        }
        presentes = agora
      })
    }).observe(document, { childList: true, subtree: true })
  })
  const modelos = await servirModeloDeVoz(page)
  const asr = await simularAsr(page, atendimento)
  const consultas: Consulta[] = await rotearCopiloto(page)
  let emCurso = 0
  let ultimaAtividade = Date.now()
  const ehConsulta = (pedido: Request) => pedido.url().endsWith('/consultar-qualificado')
  page.on('request', (pedido) => { if (ehConsulta(pedido)) { emCurso++; ultimaAtividade = Date.now() } })
  const terminou = (pedido: Request) => { if (ehConsulta(pedido)) { emCurso--; ultimaAtividade = Date.now() } }
  page.on('requestfinished', terminou)
  page.on('requestfailed', terminou)
  const lerMarcas = () => page.evaluate(() => (window as unknown as { __insightsNaTela: MarcaNaTela[] }).__insightsNaTela)
  // As mesmas regras de tools/atendimento-simulado/analisar_carga_ui.py: resposta superada por outra da mesma frase e
  // trecho já mostrado não têm cartão a esperar; quem julga o resto é a análise.
  const cartoesAEsperar = async () => {
    const marcas = await lerMarcas()
    const vistos = new Set<string>()
    return consultas.filter((consulta, indice) => {
      const resposta = consulta.resposta as Resposta | null
      if (consulta.status !== 200 || !resposta || resposta.erro) return false
      if (consultas.slice(indice + 1).some((seguinte) => seguinte.frase === consulta.frase)) return false
      const trechos = (resposta.cartoes ?? []).map((cartao) => cartao.trecho_id)
      const novos = trechos.filter((trecho) => !vistos.has(trecho))
      trechos.forEach((trecho) => vistos.add(trecho))
      return (novos.length > 0 || resposta.clarificar || resposta.alerta_risco) &&
        !marcas.some((marca) => consulta.frase.includes(marca.frase) && marca.emMs >= consulta.respondidaEm)
    }).length
  }
  const filaParada = async (quietaMs: number) => emCurso === 0 && Date.now() - ultimaAtividade >= quietaMs && await cartoesAEsperar() === 0
  const sessao = page.getByRole('region', { name: 'Gravação e transcrição', exact: true })
  const consentimento = page.getByRole('region', { name: 'Consentimento e tipo de sessão', exact: true })
  const falasPaciente = atendimento.enunciados.filter((e) => e.quem === 'paciente')
  let gravacaoEncerradaEm: number | null = null
  let sessaoEncerradaEm: number | null = null
  const inicio = Date.now()
  try {
    await entrarProfissionalNaInterface(page, conta)
    // o copiloto guarda o acervo preparado na memória; se ele reiniciou, a página do acervo prepara as obras de novo
    await page.getByRole('link', { name: 'Acervo pessoal', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Seu acervo', exact: true })).toBeVisible()
    await expect(page.locator('li.material-row')).toHaveCount(profissional.obras.length)
    await expect(page.locator('li.material-row').filter({ hasNotText: 'Pronto para selecionar na sessão' })).toHaveCount(0, { timeout: 30 * 60_000 })
    await voltarAoInicio(page)
    await abrirCarteira(page)
    const carteira = page.getByRole('region', { name: 'Pacientes', exact: true })
    const nomePaciente = `PACIENTE-CARGA-${sessaoPlano.id}-${randomUUID().slice(0, 8)}`
    await carteira.locator('details.patient-add > summary').click()
    await carteira.getByLabel('Nome do paciente', { exact: true }).fill(nomePaciente)
    await carteira.getByRole('button', { name: 'Adicionar paciente', exact: true }).click()
    await carteira.getByRole('link', { name: nomePaciente, exact: true }).click()
    await iniciarSessaoAgora(page)
    await consentimento.getByRole('checkbox', { name: 'Paciente autorizou a gravação', exact: true }).click()
    await consentimento.getByRole('checkbox', { name: 'Paciente autorizou a análise por IA local', exact: true }).click()
    // "Obras desta sessão" só lista o que a API autoriza e o copiloto já preparou; cada sessão usa 3 das 5 obras
    const obrasDaSessao = sessao.getByRole('group', { name: 'Obras desta sessão' })
    await expect(obrasDaSessao.getByRole('checkbox')).toHaveCount(profissional.obras.length, { timeout: 10 * 60_000 })
    await expect(sessao.getByText('Há materiais autorizados que não estão prontos nesta máquina', { exact: false })).toHaveCount(0)
    for (const obra of profissional.obras) {
      const caixa = obrasDaSessao.getByRole('checkbox', { name: obra.title })
      const marcar = escolhidas.includes(obra.pmcid)
      // a seleção também é controlada (reserva da obra na API): clique só quando o estado difere e espere confirmar
      if ((await caixa.isChecked()) !== marcar) await caixa.click()
      await expect(caixa).toBeChecked({ checked: marcar, timeout: 60_000 })
    }
    await sessao.getByRole('button', { name: 'Iniciar gravação', exact: true }).click()
    await expect(sessao.getByRole('status').filter({ hasText: 'Transcrição ao vivo. Seu perfil de voz identifica' })).toBeVisible()
    await expect(sessao.getByText('Selecione uma obra para receber referências nesta sessão.')).toHaveCount(0)
    // quem fala é decidido pelo perfil de voz do profissional; sem o papel "paciente", nenhuma fala vai ao copiloto
    await expect(sessao.locator('li.transcript-block').filter({ hasText: falasPaciente[0]!.ouvido })).toBeVisible({ timeout: atendimento.duracaoS * 1000 })
    await expect.poll(async () => (await sessao.getByRole('combobox', { name: /^Voz [12]$/ })
      .evaluateAll((selects) => selects.map((s) => (s as HTMLSelectElement).value))).sort(), { timeout: 90_000 }).toEqual(['paciente', 'voce'])
    await expect.poll(() => consultas.length, { timeout: 120_000, message: 'nenhuma fala do paciente chegou ao copiloto' }).toBeGreaterThan(0)
    for (const fala of falasPaciente) {
      await expect(sessao.locator('li.transcript-block').filter({ hasText: fala.ouvido })).toBeVisible({ timeout: atendimento.duracaoS * 1000 + 60_000 })
    }
    // ao vivo a fila só consulta falas recentes; as adiadas esperam o fim da gravação
    await expect.poll(() => filaParada(0), { timeout: 60_000, message: 'cartão respondido ao vivo sem aparecer na tela' }).toBe(true)
    gravacaoEncerradaEm = Date.now()
    await sessao.getByRole('button', { name: 'Encerrar gravação', exact: true }).click()
    await expect(sessao.getByRole('status').filter({ hasText: 'Transcrição concluída. Confirme os papéis das vozes.' })).toBeVisible({ timeout: 120_000 })
    await expect.poll(() => filaParada(3000), { timeout: 5 * 60_000, intervals: [1000], message: 'a fila não esvaziou depois da gravação' }).toBe(true)
    // o app só encerra a sessão com a transcrição conferida e salva no prontuário
    await sessao.getByRole('checkbox', { name: 'Conferi o texto e quem falou cada trecho ouvindo o áudio.', exact: true }).check()
    await sessao.getByRole('button', { name: 'Salvar transcrição', exact: true }).click()
    await expect(sessao.getByText('Transcrição salva no prontuário.', { exact: false })).toBeVisible({ timeout: 60_000 })
    sessaoEncerradaEm = Date.now()
    await page.getByRole('button', { name: 'Encerrar sessão', exact: true }).click()
    await expect(page.getByText('Sessão encerrada', { exact: true })).toBeVisible({ timeout: 60_000 })
  } finally {
    modelos.close()
    const naTela = await lerMarcas().catch(() => null)
    mkdirSync(join(SAIDA, 'sessoes'), { recursive: true })
    writeFileSync(join(SAIDA, 'sessoes', `${sessaoPlano.id}.json`), JSON.stringify({
      id: sessaoPlano.id, tema: sessaoPlano.tema, obras: escolhidas, visivel: info.project.use.headless === false, inicio, fim: Date.now(),
      duracaoAudioS: atendimento.duracaoS, falasPaciente: falasPaciente.map((f) => f.texto), frasesPaciente: await asr.frases(), naTela,
      gravacaoEncerradaEm, sessaoEncerradaEm, consultas, erros, status: info.status ?? null,
    }, null, 1))
  }
})
