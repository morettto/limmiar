import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { axeBuilder } from '../src/test-support/axe'
import { abrirCarteira, iniciarSessaoAgora, registrarProfissionalNaInterface } from './fixtures/profissional-interface'

const CONSENTIMENTO = 'Autorizo o uso do microfone e a transcrição nesta sessão online. O áudio segue ao servidor de transcrição, só em memória, e não é gravado.'
async function instrumentar(context: BrowserContext, negarMicrofone = false) {
  await context.addInitScript((negar) => {
    const state = window as typeof window & { testPeers: RTCPeerConnection[]; testMicRequests: number }
    state.testPeers = []; state.testMicRequests = 0
    const Peer = RTCPeerConnection
    window.RTCPeerConnection = class extends Peer {
      constructor(configuration?: RTCConfiguration) { super(configuration); state.testPeers.push(this) }
    }
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = (...args) => { state.testMicRequests++
      // Chromium com --use-fake-ui aceita sempre; a recusa do usuário é simulada na API.
      if (negar && sessionStorage.getItem('testMicLiberado') !== '1') return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
      return capture(...args).catch(error => { console.log(`test-microphone:${error.name}:${error.message}`); throw error }) }
    window.MediaRecorder = class { constructor() { throw new Error('Online must not record audio') } } as unknown as typeof MediaRecorder
  }, negarMicrofone)
}
async function audioRecebido(page: Page) {
  return page.evaluate(async () => {
    const peers = (window as typeof window & { testPeers: RTCPeerConnection[] }).testPeers
    const peer = peers.findLast(peer => peer.connectionState === 'connected')
    if (!peer) return 0
    return [...(await peer.getStats()).values()].filter(value => value.type === 'inbound-rtp')
      .reduce((total, value) => total + value.bytesReceived, 0)
  })
}

// Microfone falso com permissão já concedida: a recusa do paciente é simulada em `instrumentar`.
test.use({
  locale: 'pt-BR',
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
})

test('permissão negada permite repetir e o paciente retorna à chamada; convite revogado recusa reentrada', async ({ page, context, browser, request }) => {
  await instrumentar(context)
  const errors: string[] = []
  const audioHttp: string[] = []
  const sinais: string[] = []
  const observar = (participante: Page, papel: string) => participante.on('websocket', socket => {
    socket.on('framereceived', frame => { try { sinais.push(`${papel}:${JSON.parse(String(frame.payload)).type}`) } catch { sinais.push(`${papel}:invalid`) } })
    socket.on('close', () => sinais.push(`${papel}:closed`))
  })
  observar(page, 'professional')
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.text().startsWith('test-microphone:')) console.log(`professional:${message.text()}`) })
  page.on('request', request => { if (request.method() === 'POST' && /audio\/|speech/.test(request.url())) audioHttp.push(request.url()) })
  await registrarProfissionalNaInterface(page, request)
  await abrirCarteira(page)
  const name = `ONLINE-PERMISSAO-SINTETICA-${crypto.randomUUID()}`
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
  await page.getByRole('combobox', { name: 'Tipo de sessão', exact: true }).selectOption('online')
  await page.getByRole('button', { name: 'Gerar convite de sessão online', exact: true }).click()
  const link = await page.getByLabel('Link privado da sessão online', { exact: true }).inputValue()
  expect(new URL(link).search).toBe('')
  expect(link).not.toContain(name)
  const guestContext = await browser.newContext({ locale: 'pt-BR', permissions: ['microphone'], viewport: { width: 375, height: 812 } })
  await instrumentar(guestContext, true)
  const guest = await guestContext.newPage()
  observar(guest, 'patient')
  guest.on('pageerror', error => errors.push(error.message))
  guest.on('console', message => { if (message.text().startsWith('test-microphone:')) console.log(`patient:${message.text()}`) })
  const call = page.getByRole('region', { name: 'Chamada online', exact: true })
  try {
    await guest.goto(link)
    expect(await guest.evaluate(() => (window as typeof window & { testMicRequests: number }).testMicRequests)).toBe(0)
    await expect(guest.getByRole('button', { name: 'Entrar na sessão online', exact: true })).toBeDisabled()
    await guest.getByRole('checkbox', { name: CONSENTIMENTO, exact: true }).click()
    await guest.getByRole('button', { name: 'Entrar na sessão online', exact: true }).click()
    await expect(guest.getByRole('alert')).toHaveText('Não foi possível conectar. Confira o convite, permita o microfone e tente novamente.')
    expect(await guest.evaluate(() => (window as typeof window & { testPeers: RTCPeerConnection[] }).testPeers)).toEqual([])
    await guest.evaluate(() => sessionStorage.setItem('testMicLiberado', '1'))
    await guest.getByRole('button', { name: 'Reconectar sessão online', exact: true }).click()
    await call.getByRole('checkbox', { name: CONSENTIMENTO, exact: true }).click()
    await call.getByRole('button', { name: 'Entrar na sessão online', exact: true }).click()
    await expect(call.getByText('Sessão online conectada.', { exact: true })).toBeVisible({ timeout: 15000 })
    await expect(guest.getByText('Sessão online conectada.', { exact: true })).toBeVisible()
    await expect.poll(() => audioRecebido(page)).toBeGreaterThan(0)
    await expect.poll(() => audioRecebido(guest)).toBeGreaterThan(0)
    await guest.reload()
    await expect(call.getByText('Conexão interrompida. Tente reconectar.', { exact: true })).toBeVisible()
    expect(await guest.evaluate(() => (window as typeof window & { testMicRequests: number }).testMicRequests)).toBe(0)
    await guest.getByRole('checkbox', { name: CONSENTIMENTO, exact: true }).click()
    await guest.getByRole('button', { name: 'Entrar na sessão online', exact: true }).click()
    await expect(call.getByText('Sessão online conectada.', { exact: true })).toBeVisible()
    await expect(guest.getByText('Sessão online conectada.', { exact: true })).toBeVisible()
    await expect.poll(() => audioRecebido(guest)).toBeGreaterThan(0)
    expect((await axeBuilder(guest).analyze()).violations).toEqual([])
    await page.getByRole('button', { name: 'Encerrar e revogar convite online', exact: true }).click()
    await expect(page.getByText('Convite online encerrado.', { exact: true })).toBeVisible()
    await expect(guest.getByText('Sessão online encerrada.', { exact: true })).toBeVisible()
    await guest.reload()
    await guest.getByRole('checkbox', { name: CONSENTIMENTO, exact: true }).click()
    await guest.getByRole('button', { name: 'Entrar na sessão online', exact: true }).click()
    await expect(guest.getByRole('alert')).toHaveText('Não foi possível conectar. Confira o convite, permita o microfone e tente novamente.')
    await expect(guest.getByText('Sessão online conectada.', { exact: true })).toHaveCount(0)
    expect(audioHttp).toEqual([])
    expect(errors).toEqual([])
  } finally { console.log(JSON.stringify({ sinais })); await guestContext.close() }
})
