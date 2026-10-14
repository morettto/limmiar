import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { registrarProfissionalNaInterface, entrarProfissionalNaInterface } from './fixtures/profissional-interface'
import { simularCopiloto } from './fixtures/atendimento/copiloto-simulado'

test.use({ locale: 'pt-BR' })

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
