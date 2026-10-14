import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { registrarProfissionalNaInterface, entrarProfissionalNaInterface, abrirCarteira, iniciarSessaoAgora } from './fixtures/profissional-interface'
import { simularCopiloto } from './fixtures/atendimento/copiloto-simulado'

test.use({ locale: 'pt-BR' })

test('HTML rotulado como áudio permanece um recurso de mídia sem executar código', async ({ page, request }) => {
  const sondagens: string[] = []
  page.on('request', pedido => { if (pedido.url().includes('/audio-security-probe')) sondagens.push(pedido.url()) })
  await page.addInitScript(() => { (window as Window & { audioExecuted?: boolean }).audioExecuted = false })
  await registrarProfissionalNaInterface(page, request)
  await abrirCarteira(page)
  const lista = page.getByRole('region', { name: 'Pacientes', exact: true })
  const nome = 'Áudio hostil ' + randomUUID()
  await lista.locator('details.patient-add > summary').click()
  await lista.getByLabel('Nome do paciente', { exact: true }).fill(nome)
  await lista.getByRole('button', { name: 'Adicionar paciente', exact: true }).click()
  await lista.getByRole('link', { name: nome, exact: true }).click()
  await iniciarSessaoAgora(page)
  await page.getByRole('checkbox', { name: 'Paciente autorizou a gravação', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Paciente autorizou a gravação', exact: true })).toBeChecked()
  const sessao = page.getByRole('region', { name: 'Gravação e transcrição', exact: true })
  await sessao.getByLabel('Ou carregar áudio', { exact: true }).setInputFiles({ name: 'hostil.wav', mimeType: 'audio/wav',
    buffer: Buffer.from('<script>window.audioExecuted=true</script><img src="/audio-security-probe" onerror="window.audioExecuted=true">') })
  const player = sessao.locator('audio')
  await expect(player).toHaveAttribute('src', /^blob:/)
  await expect.poll(() => player.evaluate(elemento => (elemento as HTMLMediaElement).error?.code)).toBe(4)
  await expect(sessao.locator('img, script')).toHaveCount(0)
  expect(await page.evaluate(() => (window as Window & { audioExecuted?: boolean }).audioExecuted)).toBe(false)
  expect(sondagens).toEqual([])
})

test('metadados XMP hostis ficam como texto literal durante leitura, armazenamento e reabertura', async ({ page, request }) => {
  await simularCopiloto(page)
  const titulo = '<img src="/xmp-security-probe" onerror="window.xmpExecuted=true"><script>window.xmpExecuted=true</script>'
  const escaparXml = (texto: string) => texto.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
<rdf:RDF><rdf:Description><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escaparXml(titulo)}</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>Autora sintética</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF>
<script xmlns="http://www.w3.org/1999/xhtml">window.xmpExecuted=true</script>
<img xmlns="http://www.w3.org/1999/xhtml" src="/xmp-security-probe" onerror="window.xmpExecuted=true" />
</x:xmpmeta>`
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R /Metadata 3 0 R >>',
    '<< /Type /Pages /Kids [] /Count 0 >>',
    `<< /Type /Metadata /Subtype /XML /Length ${Buffer.byteLength(xmp)} >>\nstream\n${xmp}\nendstream`,
  ]
  let pdf = '%PDF-1.7\n'
  const offsets = objetos.map((objeto, i) => {
    const offset = Buffer.byteLength(pdf)
    pdf += `${i + 1} 0 obj\n${objeto}\nendobj\n`
    return offset
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 4\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const sondagens: string[] = []
  page.on('request', pedido => { if (pedido.url().includes('/xmp-security-probe')) sondagens.push(pedido.url()) })
  await page.addInitScript(() => { (window as Window & { xmpExecuted?: boolean }).xmpExecuted = false })
  const conta = await registrarProfissionalNaInterface(page, request)
  await page.getByRole('link', { name: 'Acervo pessoal', exact: true }).click()
  await page.getByLabel('Arquivo do material', { exact: true }).setInputFiles({ name: 'xmp-hostil.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) })
  await expect(page.getByLabel('Título da obra', { exact: true })).toHaveValue(titulo)
  await expect(page.getByLabel('Autores', { exact: true })).toHaveValue('Autora sintética')
  await page.getByRole('button', { name: 'Guardar no acervo', exact: true }).click()
  const linha = page.locator('li.material-row').filter({ hasText: titulo })
  await expect(linha).toBeVisible()
  await expect(linha.locator('img, script')).toHaveCount(0)
  expect(await page.evaluate(() => (window as Window & { xmpExecuted?: boolean }).xmpExecuted)).toBe(false)
  expect(sondagens).toEqual([])
  await page.reload()
  await entrarProfissionalNaInterface(page, conta)
  await page.getByRole('link', { name: 'Acervo pessoal', exact: true }).click()
  await expect(linha).toBeVisible()
  await expect(linha.locator('img, script')).toHaveCount(0)
  expect(await page.evaluate(() => (window as Window & { xmpExecuted?: boolean }).xmpExecuted)).toBe(false)
  expect(sondagens).toEqual([])
})

test('preparo após upload mostra avanço e falha reais sem bloquear autorização, revogação ou repetição', async ({ page, request }) => {
  await simularCopiloto(page)
  const titulo = 'Acervo de regressão ' + randomUUID()
  const conteudo = 'Texto privado sintético que só vai em claro ao serviço local de preparação.'
  const escritas: string[] = []
  let id = '', sha256 = '', preparos = 0
  let fase: 'leitura' | 'referencias' = 'leitura'
  let completo = 1
  let falhou = false
  let pronto = false
  page.on('request', pedido => {
    if (pedido.url().includes('/accounts/') && pedido.method() !== 'GET') escritas.push(pedido.postData() ?? '')
  })
  // A API de armazenamento e a cifra são reais; só estados do trabalho bibliográfico são controlados.
  await page.route('**/copiloto/api/acervo/**', route => {
    const pedido = route.request()
    if (pedido.method() === 'POST') {
      id = new URL(pedido.url()).pathname.split('/').at(-2)!
      sha256 = /name="sha256"\r\n\r\n([0-9a-f]{64})/.exec(pedido.postDataBuffer()!.toString('latin1'))![1]!
      preparos++; falhou = false
      return route.fulfill({ status: 202, json: { materialId: id, sha256, ready: false, stage: 'aguardando' } })
    }
    return route.fulfill({ json: { materials: id ? [{ materialId: id, sha256, ready: pronto,
      stage: falhou ? 'falhou' : 'organizando', paragraphs: pronto ? 4 : undefined,
      progress: falhou || pronto ? undefined : { phase: fase, completed: completo, total: 4 } }] : [] } })
  })
  const conta = await registrarProfissionalNaInterface(page, request)
  await page.getByRole('link', { name: 'Acervo pessoal', exact: true }).click()
  await page.getByLabel('Arquivo do material', { exact: true }).setInputFiles({ name: 'progresso.txt', mimeType: 'text/plain', buffer: Buffer.from(conteudo) })
  await page.getByLabel('Título da obra', { exact: true }).fill(titulo)
  await page.getByLabel('Autores', { exact: true }).fill('Autora sintética')
  await page.getByRole('button', { name: 'Guardar no acervo', exact: true }).click()
  const linha = page.locator('li.material-row').filter({ hasText: titulo })
  const autorizacao = linha.getByRole('checkbox', { name: 'Autorizar nas minhas consultas', exact: true })
  await expect.poll(() => preparos).toBe(1)
  await expect(autorizacao).not.toBeChecked()
  await expect(linha.getByText('Lendo páginas: 1 de 4', { exact: true })).toBeVisible()
  await expect(linha.getByText('25%', { exact: true })).toBeVisible()
  await expect(linha.getByRole('progressbar')).toHaveAttribute('value', '1')
  await autorizacao.click()
  await expect(autorizacao).toBeChecked()
  expect(preparos).toBe(1)
  await expect(linha.getByRole('button', { name: 'Recuperar arquivo', exact: true })).toBeEnabled()
  fase = 'referencias'; completo = 3
  await expect(linha.getByText('Preparando referências: 3 de 4', { exact: true })).toBeVisible()
  await expect(linha.getByText('75%', { exact: true })).toBeVisible()
  await autorizacao.click()
  await expect(autorizacao).not.toBeChecked()
  expect(preparos).toBe(1)
  falhou = true
  await expect(linha.getByRole('alert')).toHaveText('Não foi possível preparar este arquivo. Tente novamente.')
  await linha.getByRole('button', { name: 'Preparar arquivo', exact: true }).click()
  await expect.poll(() => preparos).toBe(2)
  await expect(autorizacao).not.toBeChecked()
  pronto = true
  await expect(linha.getByText('Pronto para selecionar na sessão', { exact: true })).toBeVisible()
  await expect(linha.getByRole('progressbar')).toHaveCount(0)
  expect(escritas.join('')).not.toContain(titulo)
  expect(escritas.join('')).not.toContain(conteudo)
  await page.reload()
  await entrarProfissionalNaInterface(page, conta)
  await page.getByRole('link', { name: 'Acervo pessoal', exact: true }).click()
  await expect(page.locator('li.material-row').filter({ hasText: titulo }).getByRole('checkbox')).not.toBeChecked()
  expect(preparos).toBe(2)
})
