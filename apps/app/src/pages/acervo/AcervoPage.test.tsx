import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { File as NodeFile } from 'node:buffer'
import { I18nProvider } from '@lingui/react'
import { webcrypto } from '@limmiar/crypto'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { deferred } from '../../test-support/deferred'
import * as materialCrypto from '../../entities/material/material-crypto'
import * as api from '../../entities/material/api'
import * as local from '../../entities/material/local-material'
import { materialHash, openMaterialContent, openMaterialMetadata, sealMaterial, type SealedMaterial } from '../../entities/material/material-crypto'
import { AcervoPage } from './AcervoPage'

let kek: CryptoKey
let material: SealedMaterial
let items: api.MaterialSummary[]
const access = { baseUrl: '', accountId: 'owner', accessToken: 'token' }
const bytes = new TextEncoder().encode('Referência privada sintética.')
function page(accessToken = access.accessToken) { return <I18nProvider i18n={i18n}><AcervoPage {...access} accessToken={accessToken} kek={kek} /></I18nProvider> }
function mount() { return render(page()) }
async function loaded() { await waitFor(() => expect(screen.queryByText('Abrindo seu acervo...')).toBeNull()) }
const HINT = 'Escolha o arquivo primeiro. Título, autores e edição são lidos do documento e liberados para edição em seguida.'
const FIELDS = ['Título da obra', 'Autores', 'Referência bibliográfica ou edição']
const latin1 = (text: string) => Uint8Array.from(text, char => char.charCodeAt(0))
const pdfWithInfo = (dict: string) => latin1(`%PDF-1.7\n1 0 obj\n<<${dict}>>\nendobj\ntrailer\n<</Info 1 0 R>>\n%%EOF`)
function pick(name: string, content: Uint8Array = bytes) {
  fireEvent.change(screen.getByLabelText('Arquivo do material'), { target: { files: [new NodeFile([content], name)] } })
}
async function chooseFile(name = 'obra.txt', content: Uint8Array = bytes) {
  pick(name, content)
  await waitFor(() => expect(screen.getByLabelText('Título da obra')).toHaveProperty('disabled', false))
  fireEvent.change(screen.getByLabelText('Título da obra'), { target: { value: ' Obra nova ' } })
  fireEvent.change(screen.getByLabelText('Autores'), { target: { value: ' Autora nova ' } })
  fireEvent.change(screen.getByLabelText('Referência bibliográfica ou edição'), { target: { value: ' Edição nova ' } })
}
beforeAll(async () => dynamicActivate('pt-BR'))
beforeEach(async () => {
  kek = await webcrypto.importKek(new Uint8Array(32).fill(8))
  material = await sealMaterial(kek, access.accountId, 'material', { title: 'Livro privado', authors: 'Autora fictícia', reference: 'Edição 2026', filename: 'obra.txt', type: 'txt', size: bytes.length, sha256: await materialHash(bytes) }, bytes)
  items = [{ ...material, authorized: false, createdAt: 'date' }]
  vi.spyOn(api, 'listMaterials').mockImplementation(async () => ({ ok: true, materials: items }))
  vi.spyOn(api, 'uploadMaterial').mockResolvedValue({ ok: true })
  vi.spyOn(api, 'authorizeMaterial').mockResolvedValue({ ok: true })
  vi.spyOn(api, 'deleteMaterial').mockResolvedValue({ ok: true })
  vi.spyOn(api, 'getMaterialContent').mockResolvedValue({ ok: true, ciphertext: material.contentCiphertext })
  vi.spyOn(local, 'listPreparedMaterials').mockResolvedValue([])
  vi.spyOn(local, 'prepareLocalMaterial').mockResolvedValue()
  vi.spyOn(local, 'removeLocalMaterial').mockResolvedValue()
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:private'), configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('reabre uma preparação falha com ação de repetir, sem afirmar que a obra está pronta', async () => {
  vi.mocked(local.listPreparedMaterials).mockResolvedValue([{ materialId: 'material', ready: false, sha256: '', stage: 'falhou' }])
  mount(); await loaded()
  expect(screen.getByText('Não foi possível preparar este arquivo. Tente novamente.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Preparar arquivo' })).toBeTruthy()
  expect(screen.queryByText('Pronto para selecionar na sessão')).toBeNull()
})

it('acompanha preparo sem bloquear a estante e apresenta pronto ou falha pelo estado do serviço', async () => {
  const outro = await seal('outro'), falho = await seal('falho')
  items.push({ ...outro, authorized: false, createdAt: '' }, { ...falho, authorized: false, createdAt: '' })
  vi.mocked(local.listPreparedMaterials).mockResolvedValueOnce([]).mockResolvedValue([
    { materialId: 'material', ready: true, sha256: await materialHash(bytes), paragraphs: 1, preparedAt: '' },
    { materialId: 'outro', ready: false, sha256: '', stage: 'organizando' },
    { materialId: 'falho', ready: false, sha256: '', stage: 'falhou' },
  ])
  mount(); await loaded()
  fireEvent.click(screen.getAllByRole('button', { name: 'Preparar arquivo' })[0]!)
  await waitFor(() => expect(screen.getByText('Pronto para selecionar na sessão')).toBeTruthy(), { timeout: 2500 })
  expect(screen.getByText('Não foi possível preparar este arquivo. Tente novamente.')).toBeTruthy()
  expect(screen.getByText('Organizando o conteúdo e preparando suas referências...')).toBeTruthy()
  expect(screen.getAllByRole('checkbox')[0]).toHaveProperty('disabled', false)
})

it('mostra páginas e referências realmente processadas, atualizando percentual sem bloquear autorização', async () => {
  const estado: local.PreparedMaterial = { materialId: 'material', ready: false, sha256: '', stage: 'organizando',
    progress: { phase: 'leitura', completed: 2, total: 10 } }
  vi.mocked(local.listPreparedMaterials).mockResolvedValue([estado])
  mount(); await loaded()
  expect(screen.getByText('Lendo páginas: 2 de 10')).toBeTruthy()
  expect(screen.getByRole('progressbar', { name: 'Avanço da preparação' })).toHaveProperty('value', 2)
  expect(screen.getByRole('progressbar')).toHaveProperty('max', 10)
  expect(screen.getByText('20%')).toBeTruthy()
  vi.mocked(local.listPreparedMaterials).mockResolvedValue([{ ...estado, progress: { phase: 'referencias', completed: 8, total: 24 } }])
  await waitFor(() => expect(screen.getByText('Preparando referências: 8 de 24')).toBeTruthy(), { timeout: 2500 })
  expect(screen.getByText('33%')).toBeTruthy()
  expect(screen.getByRole('checkbox', { name: 'Autorizar nas minhas consultas' })).toHaveProperty('disabled', false)
  expect(screen.queryByText('Pronto para selecionar na sessão')).toBeNull()
})

it.each(['resolve', 'rejeita'])('ignora resposta de acompanhamento (%s) depois de sair', async modo => {
  const consulta = deferred<local.PreparedMaterial[]>()
  vi.mocked(local.listPreparedMaterials).mockResolvedValueOnce([]).mockReturnValueOnce(consulta.promise)
  const view = mount(); await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Preparar arquivo' }))
  await waitFor(() => expect(local.listPreparedMaterials).toHaveBeenCalledTimes(2), { timeout: 2500 })
  view.unmount()
  await act(async () => { if (modo === 'resolve') consulta.resolve([]); else consulta.reject(new Error('tarde')) })
  expect(screen.queryByRole('alert')).toBeNull()
})

it('informa falha de acompanhamento e falha ao abrir o arquivo para preparo', async () => {
  vi.mocked(local.listPreparedMaterials).mockResolvedValueOnce([]).mockRejectedValue(new Error('fora'))
  mount(); await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Preparar arquivo' }))
  await screen.findByText('Organizando o conteúdo e preparando suas referências...')
  await waitFor(() => expect(screen.getByText('Não foi possível acompanhar o preparo. Tente novamente.')).toBeTruthy(), { timeout: 2500 })
  cleanup()
  vi.mocked(local.listPreparedMaterials).mockResolvedValue([])
  vi.mocked(api.getMaterialContent).mockRejectedValueOnce(new Error('arquivo indisponível'))
  mount(); await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Preparar arquivo' }))
  await screen.findByText('Não foi possível preparar este arquivo. Tente novamente.')
})

it('abre só metadados cifrados, busca local e oferece ações com autorização retirada por padrão', async () => {
  mount(); expect(screen.getByText('Abrindo seu acervo...')).toBeTruthy()
  await screen.findByText('Livro privado')
  expect(screen.getByText('Autora fictícia')).toBeTruthy()
  expect(screen.getByText('Guardado · uso não autorizado')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Buscar no acervo'), { target: { value: 'não existe' } })
  expect(screen.getByText('Nenhum material corresponde à busca.')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Buscar no acervo'), { target: { value: 'edição' } })
  expect(screen.getByText('Livro privado')).toBeTruthy()
  expect(api.getMaterialContent).not.toHaveBeenCalled()
})
it('exibe vazio e não envia formulário sem arquivo ou metadados obrigatórios', async () => {
  items = []; mount(); await loaded()
  expect(screen.getByText('Uma estante para suas referências')).toBeTruthy()
  const hint = screen.getByText(HINT)
  for (const label of [...FIELDS, 'Arquivo do material']) expect(screen.getByLabelText(label).getAttribute('aria-describedby')).toBe(hint.id)
  for (const label of FIELDS) expect(screen.getByLabelText(label)).toHaveProperty('disabled', true)
  expect(screen.getByLabelText('Arquivo do material')).toHaveProperty('disabled', false)
  expect(screen.getByRole('button', { name: 'Guardar no acervo' })).toHaveProperty('disabled', true)
  fireEvent.change(screen.getByLabelText('Arquivo do material'), { target: { files: null } })
  fireEvent.submit(screen.getByRole('button', { name: 'Guardar no acervo' }).closest('form')!)
  expect(api.uploadMaterial).not.toHaveBeenCalled()
})
it('cifra bytes e bibliografia antes do upload e informa armazenamento sem afirmar preparação', async () => {
  mount(); await loaded(); await chooseFile()
  fireEvent.click(screen.getByRole('button', { name: 'Guardar no acervo' }))
  await screen.findByText('Material guardado. Estamos preparando suas referências em segundo plano.')
  const sealed = vi.mocked(api.uploadMaterial).mock.lastCall![1]
  const opened = await openMaterialMetadata(kek, access.accountId, sealed)
  expect(opened.metadata).toMatchObject({ title: 'Obra nova', authors: 'Autora nova', reference: 'Edição nova' })
  expect(opened.metadata.sha256).toBe(await materialHash(bytes))
  expect(Array.from(await openMaterialContent(opened.dek, access.accountId, sealed.materialId, sealed.contentCiphertext))).toEqual(Array.from(bytes))
  expect(new TextDecoder().decode(sealed.contentCiphertext)).not.toContain('Referência')
  expect(local.prepareLocalMaterial).toHaveBeenCalledWith(access, sealed.materialId, expect.objectContaining({ title: 'Obra nova' }), expect.anything())
  expect(Array.from(vi.mocked(local.prepareLocalMaterial).mock.lastCall![3])).toEqual(Array.from(bytes))
  for (const label of FIELDS) {
    expect(screen.getByLabelText(label)).toHaveProperty('value', '')
    expect(screen.getByLabelText(label)).toHaveProperty('disabled', true)
  }
  expect(screen.getByText(HINT)).toBeTruthy()
})
it('só libera o envio com título e autores preenchidos e o bloqueia enquanto envia', async () => {
  mount(); await loaded(); await chooseFile()
  const submit = screen.getByRole('button', { name: 'Guardar no acervo' })
  expect(submit).toHaveProperty('disabled', false)
  fireEvent.change(screen.getByLabelText('Título da obra'), { target: { value: '   ' } })
  expect(submit).toHaveProperty('disabled', true)
  fireEvent.change(screen.getByLabelText('Título da obra'), { target: { value: 'Obra' } })
  fireEvent.change(screen.getByLabelText('Autores'), { target: { value: '   ' } })
  expect(submit).toHaveProperty('disabled', true)
  fireEvent.change(screen.getByLabelText('Autores'), { target: { value: 'Autora' } })
  let finish!: () => void
  vi.mocked(api.uploadMaterial).mockImplementationOnce(() => new Promise(done => { finish = () => done({ ok: true }) }))
  fireEvent.click(submit)
  await screen.findByText('Enviando o material cifrado...')
  expect(submit).toHaveProperty('disabled', true)
  expect(screen.getByLabelText('Arquivo do material')).toHaveProperty('disabled', true)
  finish()
  await screen.findByText('Material guardado. Estamos preparando suas referências em segundo plano.')
  expect(submit).toHaveProperty('disabled', true)
})
it('recusa arquivo inválido já na escolha, mantém os campos travados e aceita outro arquivo depois', async () => {
  mount(); await loaded(); pick('audio.pdf')
  await screen.findByText('Escolha um PDF válido ou texto UTF-8, com até 20 MB.')
  expect(screen.queryByText('Lendo os dados do documento...')).toBeNull()
  for (const label of FIELDS) expect(screen.getByLabelText(label)).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: 'Guardar no acervo' })).toHaveProperty('disabled', true)
  expect(screen.getByLabelText('Arquivo do material')).toHaveProperty('disabled', false)
  expect(api.uploadMaterial).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).toBeNull()
})
it('erro da API não faz perder os campos para repetir', async () => {
  mount(); await loaded(); await chooseFile()
  vi.mocked(api.uploadMaterial).mockResolvedValueOnce({ ok: false, code: 'materials.already_exists', params: {} })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar no acervo' }))
  await screen.findByText('Não foi possível concluir. Tente novamente.')
  expect(screen.getByLabelText('Título da obra')).toHaveProperty('value', ' Obra nova ')
})
it('lê título e autores do PDF enquanto os campos ficam travados e depois libera a edição', async () => {
  mount(); await loaded()
  const pdf = new NodeFile([pdfWithInfo('/Title (Luto e melancolia) /Author (Sigmund Freud)')], 'freud.pdf')
  const original = pdf.arrayBuffer.bind(pdf)
  let release!: () => void
  vi.spyOn(pdf, 'arrayBuffer').mockImplementation(() => new Promise<ArrayBuffer>(done => { release = () => done(original()) }))
  fireEvent.change(screen.getByLabelText('Arquivo do material'), { target: { files: [pdf] } })
  await screen.findByText('Lendo os dados do documento...')
  for (const label of FIELDS) expect(screen.getByLabelText(label)).toHaveProperty('disabled', true)
  expect(screen.getByLabelText('Arquivo do material')).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: 'Guardar no acervo' }).closest('form')!.getAttribute('aria-busy')).toBe('true')
  release()
  await screen.findByText('Dados do documento carregados. Confira e ajuste antes de guardar.')
  expect(screen.getByLabelText('Título da obra')).toHaveProperty('value', 'Luto e melancolia')
  expect(screen.getByLabelText('Autores')).toHaveProperty('value', 'Sigmund Freud')
  expect(screen.getByLabelText('Referência bibliográfica ou edição')).toHaveProperty('value', '')
  for (const label of FIELDS) expect(screen.getByLabelText(label)).toHaveProperty('disabled', false)
  expect(screen.getByLabelText('Título da obra').hasAttribute('aria-describedby')).toBe(false)
  expect(screen.queryByText(HINT)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Guardar no acervo' }))
  await screen.findByText('Material guardado. Estamos preparando suas referências em segundo plano.')
  const sealed = vi.mocked(api.uploadMaterial).mock.lastCall![1]
  expect((await openMaterialMetadata(kek, access.accountId, sealed)).metadata).toMatchObject({ title: 'Luto e melancolia', authors: 'Sigmund Freud', filename: 'freud.pdf', type: 'pdf' })
})
it('limita título e autores lidos do documento ao tamanho dos campos', async () => {
  mount(); await loaded()
  pick('x.pdf', pdfWithInfo(`/Title (${'t'.repeat(400)}) /Author (${'a'.repeat(600)})`))
  await waitFor(() => expect(screen.getByLabelText('Título da obra')).toHaveProperty('disabled', false))
  expect((screen.getByLabelText('Título da obra') as HTMLInputElement).value).toHaveLength(300)
  expect((screen.getByLabelText('Autores') as HTMLInputElement).value).toHaveLength(500)
})
it('nova escolha descarta as edições anteriores e cancelar o seletor trava os campos de novo', async () => {
  mount(); await loaded(); await chooseFile('primeira.txt')
  pick('Segunda_obra.txt')
  for (const label of FIELDS) {
    expect(screen.getByLabelText(label)).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(label)).toHaveProperty('value', '')
  }
  await waitFor(() => expect(screen.getByLabelText('Título da obra')).toHaveProperty('disabled', false))
  expect(screen.getByLabelText('Título da obra')).toHaveProperty('value', 'Segunda obra')
  expect(screen.getByLabelText('Autores')).toHaveProperty('value', '')
  fireEvent.change(screen.getByLabelText('Autores'), { target: { value: 'Editado' } })
  fireEvent.change(screen.getByLabelText('Arquivo do material'), { target: { files: [] } })
  await act(async () => {})
  expect(screen.queryByRole('alert')).toBeNull()
  for (const label of FIELDS) {
    expect(screen.getByLabelText(label)).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(label)).toHaveProperty('value', '')
  }
  expect(screen.getByText(HINT)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Guardar no acervo' })).toHaveProperty('disabled', true)
})
it('autorizar e revogar são rápidos e não baixam nem preparam o arquivo', async () => {
  mount(); await loaded()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Autorizar nas minhas consultas' }))
  await screen.findByText('Material disponível para selecionar nas suas sessões.')
  expect(api.authorizeMaterial).toHaveBeenCalledWith(access, 'material', true)
  expect(local.prepareLocalMaterial).not.toHaveBeenCalled()
  expect(api.getMaterialContent).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Autorizar nas minhas consultas' }))
  await screen.findByText('Autorização retirada. Este material não participa das suas consultas.')
  expect(local.removeLocalMaterial).not.toHaveBeenCalled()
})
it('preparo falho é visível, libera a estante e permite repetir em segundo plano', async () => {
  vi.mocked(local.prepareLocalMaterial).mockRejectedValueOnce(new Error('material.prepare'))
  mount(); await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Preparar arquivo' }))
  await screen.findByText('Não foi possível preparar este arquivo. Tente novamente.')
  expect(screen.getByRole('button', { name: 'Recuperar arquivo' })).toHaveProperty('disabled', false)
  fireEvent.click(screen.getByRole('button', { name: 'Preparar arquivo' }))
  await screen.findByText('Organizando o conteúdo e preparando suas referências...')
  expect(local.prepareLocalMaterial).toHaveBeenCalledTimes(2)
})
it('recusa autorização e leitura falhas, recupera arquivo e libera a URL de memória', async () => {
  mount(); await loaded()
  vi.mocked(api.authorizeMaterial).mockResolvedValueOnce({ ok: false, code: 'materials.not_found', params: {} })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Autorizar nas minhas consultas' }))
  await screen.findByText('Não foi possível concluir. Tente novamente.')
  expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
  vi.mocked(api.getMaterialContent).mockResolvedValueOnce({ ok: false, code: 'materials.not_found', params: {} })
  fireEvent.click(screen.getByRole('button', { name: 'Recuperar arquivo' }))
  await screen.findByText('Não foi possível concluir. Tente novamente.')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Recuperar arquivo' })).toHaveProperty('disabled', false))
  fireEvent.click(screen.getByRole('button', { name: 'Recuperar arquivo' }))
  await screen.findByText('Arquivo recuperado e decifrado neste dispositivo.')
  expect(URL.createObjectURL).toHaveBeenCalledOnce()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private')
})
it('exclusão tem confirmação e cancelamento; erro mantém o item, sucesso remove storage e RAM', async () => {
  items[0]!.authorized = true
  vi.mocked(local.listPreparedMaterials).mockResolvedValue([{ materialId: 'material', ready: true, sha256: await materialHash(bytes), paragraphs: 1, preparedAt: '' }])
  mount(); await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Excluir material' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  expect(api.deleteMaterial).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Excluir material' }))
  vi.mocked(api.deleteMaterial).mockResolvedValueOnce({ ok: false, code: 'materials.not_found', params: {} })
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
  await screen.findByText('Não foi possível concluir. Tente novamente.')
  expect(screen.getByText('Livro privado')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
  await screen.findByText('Material excluído do seu acervo.')
  expect(screen.queryByText('Livro privado')).toBeNull()
  expect(local.removeLocalMaterial).toHaveBeenCalledWith(access, 'material')
})
it('autoriza um item sem alterar a autorização ou disponibilidade dos outros materiais', async () => {
  const second = await sealMaterial(kek, access.accountId, 'second', { title: 'Outro livro', authors: 'Outro autor', reference: '', filename: 'outra.txt', type: 'txt', size: bytes.length, sha256: await materialHash(bytes) }, bytes)
  items.push({ ...second, authorized: false, createdAt: '' })
  mount(); await loaded()
  fireEvent.click(screen.getAllByRole('checkbox', { name: 'Autorizar nas minhas consultas' })[0]!)
  await screen.findByText('Material disponível para selecionar nas suas sessões.')
  expect(screen.getAllByRole('checkbox')[1]).toHaveProperty('checked', false)
  expect(screen.getByText('Outro livro')).toBeTruthy()
  expect(screen.getByText('Guardado · uso não autorizado')).toBeTruthy()
})
it('recupera estado pronto pelo hash e não confunde conta, autorização ou conteúdo diferente', async () => {
  items[0]!.authorized = true
  const sha256 = await materialHash(bytes)
  vi.mocked(local.listPreparedMaterials).mockResolvedValue([
    { materialId: 'other', ready: true, sha256, paragraphs: 1, preparedAt: '' },
    { materialId: 'material', ready: true, sha256: 'wrong', paragraphs: 1, preparedAt: '' },
    { materialId: 'material', ready: true, sha256, paragraphs: 1, preparedAt: '' },
  ])
  mount(); await screen.findByText('Pronto para selecionar na sessão')
  expect(screen.queryByRole('button', { name: 'Preparar arquivo' })).toBeNull()
})
it('erro ao carregar pode ser repetido e respostas tardias após sair são ignoradas', async () => {
  vi.mocked(api.listMaterials).mockResolvedValueOnce({ ok: false, code: 'auth.access_token_invalid', params: {} })
  mount(); await screen.findByText('Não foi possível abrir seu acervo. Tente novamente.')
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  await screen.findByText('Livro privado')
  cleanup()
  let resolve!: (value: Awaited<ReturnType<typeof api.listMaterials>>) => void
  vi.mocked(api.listMaterials).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const view = mount(); view.unmount()
  await act(async () => resolve({ ok: true, materials: items }))
  vi.mocked(api.listMaterials).mockRejectedValueOnce(new Error('late'))
  const failed = mount(); failed.unmount(); await act(async () => {})
})
it('estado do motor indisponível não impede recuperar a estante cifrada ou baixar PDF', async () => {
  material = await sealMaterial(kek, access.accountId, 'material', { title: 'PDF privado', authors: '', reference: '', filename: 'obra.pdf', type: 'pdf', size: bytes.length, sha256: await materialHash(bytes) }, bytes)
  items = [{ ...material, authorized: true, createdAt: '' }]
  vi.mocked(api.getMaterialContent).mockResolvedValue({ ok: true, ciphertext: material.contentCiphertext })
  vi.mocked(local.listPreparedMaterials).mockRejectedValue(new Error('offline'))
  mount(); await screen.findByText('PDF privado')
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Recuperar arquivo' }))
  await screen.findByText('Arquivo recuperado e decifrado neste dispositivo.')
})

async function seal(id: string, metadata: Partial<materialCrypto.MaterialMetadata> = {}) {
  return sealMaterial(kek, access.accountId, id, { title: `Obra ${id}`, authors: 'Autora', reference: 'Edição', filename: `${id}.txt`, type: 'txt', size: bytes.length, sha256: await materialHash(bytes), ...metadata }, bytes)
}
const region = (name: string) => screen.getByRole('region', { name })

it('começa carregando, com os campos vazios, e consulta a estante e o motor local com a conta', async () => {
  expect(renderToString(page())).toContain('Abrindo seu acervo...')
  const abertura = deferred<Awaited<ReturnType<typeof api.listMaterials>>>()
  vi.mocked(api.listMaterials).mockReturnValueOnce(abertura.promise)
  mount()
  expect(region('Materiais do acervo').getAttribute('aria-busy')).toBe('true')
  expect(region('Adicionar material')).toBeTruthy()
  for (const label of FIELDS) expect(screen.getByLabelText(label)).toHaveProperty('value', '')
  await act(async () => abertura.resolve({ ok: true, materials: items }))
  await screen.findByText('Livro privado')
  expect(region('Materiais do acervo').getAttribute('aria-busy')).toBe('false')
  expect(api.listMaterials).toHaveBeenCalledWith(access)
  expect(local.listPreparedMaterials).toHaveBeenCalledWith(access)
})

it('enviar sem arquivo escolhido não mostra erro nem status', async () => {
  mount(); await loaded()
  fireEvent.submit(screen.getByRole('button', { name: 'Guardar no acervo' }).closest('form')!)
  await act(async () => {})
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
})

it('mostra a verificação e a cifra antes do envio, bloqueia a estante enquanto trabalha e relê a cada envio', async () => {
  mount(); await loaded(); await chooseFile()
  const hash = deferred<string>()
  const original = materialCrypto.materialHash
  vi.spyOn(materialCrypto, 'materialHash').mockReturnValueOnce(hash.promise)
  fireEvent.click(screen.getByRole('button', { name: 'Guardar no acervo' }))
  expect((await screen.findByRole('status')).textContent).toBe('Verificando e cifrando o material...')
  expect(region('Materiais do acervo').getAttribute('aria-busy')).toBe('true')
  await act(async () => hash.resolve(await original(bytes)))
  await screen.findByText('Material guardado. Estamos preparando suas referências em segundo plano.')
  await waitFor(() => expect(api.listMaterials).toHaveBeenCalledTimes(2))
  await chooseFile()
  fireEvent.click(screen.getByRole('button', { name: 'Guardar no acervo' }))
  await waitFor(() => expect(api.uploadMaterial).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(api.listMaterials).toHaveBeenCalledTimes(3))
})

it('cada nova tentativa depois de falhar a abertura relê o acervo', async () => {
  vi.mocked(api.listMaterials).mockResolvedValue({ ok: false, code: 'auth.access_token_invalid', params: {} })
  mount()
  await screen.findByText('Não foi possível abrir seu acervo. Tente novamente.')
  for (const total of [2, 3, 4]) {
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(api.listMaterials).toHaveBeenCalledTimes(total))
    await screen.findByText('Não foi possível abrir seu acervo. Tente novamente.')
  }
})

it.each([
  ['outro material com o mesmo hash', { materialId: 'other', ready: true as boolean, sha256: 'HASH' }],
  ['o mesmo material com hash diferente', { materialId: 'material', ready: true as boolean, sha256: 'diferente' }],
  ['o mesmo material ainda não pronto', { materialId: 'material', ready: false as boolean, sha256: 'HASH', stage: 'aguardando' }],
])('não marca como preparado quando o motor só tem %s', async (_nome, estado) => {
  items[0]!.authorized = true
  const sha256 = await materialHash(bytes)
  vi.mocked(local.listPreparedMaterials).mockResolvedValue([{ ...estado, sha256: estado.sha256 === 'HASH' ? sha256 : estado.sha256, paragraphs: 1, preparedAt: '' } as local.PreparedMaterial])
  mount()
  if (estado.ready) {
    expect(await screen.findByText('Arquivo guardado · aguardando preparação')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Preparar arquivo' })).toBeTruthy()
  } else {
    expect(await screen.findByText('Organizando o conteúdo e preparando suas referências...')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Preparar arquivo' })).toBeNull()
  }
  expect(screen.queryByText('Pronto para selecionar na sessão')).toBeNull()
})

it('uma resposta tardia de outra sessão não substitui o acervo atual nem apaga a carga da atual', async () => {
  const antiga = deferred<Awaited<ReturnType<typeof api.listMaterials>>>()
  const atual = deferred<Awaited<ReturnType<typeof api.listMaterials>>>()
  vi.mocked(api.listMaterials).mockReturnValueOnce(antiga.promise).mockReturnValueOnce(atual.promise)
  const view = render(page('token-antigo'))
  view.rerender(page('token-novo'))
  await waitFor(() => expect(api.listMaterials).toHaveBeenCalledTimes(2))

  await act(async () => atual.resolve({ ok: true, materials: [{ ...(await seal('nova')), authorized: false, createdAt: '' }] }))
  expect(await screen.findByText('Obra nova')).toBeTruthy()

  await act(async () => antiga.resolve({ ok: true, materials: [{ ...(await seal('velha')), authorized: false, createdAt: '' }] }))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
  expect(screen.queryByText('Obra velha')).toBeNull()
  expect(screen.getByText('Obra nova')).toBeTruthy()
})

it('a finalização tardia de uma sessão anterior não encerra a carga da atual', async () => {
  const antiga = deferred<Awaited<ReturnType<typeof api.listMaterials>>>()
  const atual = deferred<Awaited<ReturnType<typeof api.listMaterials>>>()
  vi.mocked(api.listMaterials).mockReturnValueOnce(antiga.promise).mockReturnValueOnce(atual.promise)
  const view = render(page('token-antigo'))
  view.rerender(page('token-novo'))
  await waitFor(() => expect(api.listMaterials).toHaveBeenCalledTimes(2))

  await act(async () => antiga.resolve({ ok: true, materials: items }))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
  expect(screen.getByText('Abrindo seu acervo...')).toBeTruthy()

  await act(async () => atual.resolve({ ok: true, materials: items }))
  expect(await screen.findByText('Livro privado')).toBeTruthy()
})

it('uma falha tardia de outra sessão não aparece sobre o acervo atual', async () => {
  const antiga = deferred<Awaited<ReturnType<typeof api.listMaterials>>>()
  vi.mocked(api.listMaterials).mockReturnValueOnce(antiga.promise)
  const view = render(page('token-antigo'))
  view.rerender(page('token-novo'))
  await screen.findByText('Livro privado')

  await act(async () => antiga.reject(new Error('tardia')))

  expect(screen.queryByRole('alert')).toBeNull()
})

it('mostra o tipo em maiúsculas, o tamanho em MB com uma casa e só as linhas que existem', async () => {
  const completa = await seal('completa', { type: 'pdf', size: 1294467, authors: 'Fulana', reference: 'Segunda edição' })
  const simples = await seal('simples', { authors: '', reference: '', size: 3145728 })
  items = [{ ...completa, authorized: false, createdAt: '' }, { ...simples, authorized: false, createdAt: '' }]
  mount(); await screen.findByText('Obra completa')
  const [linhaCompleta, linhaSimples] = screen.getAllByRole('listitem')
  expect(Array.from(linhaCompleta!.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['PDF · 1,2 MB', 'Fulana', 'Segunda edição', 'Arquivo guardado · aguardando preparação', 'Guardado · uso não autorizado'])
  expect(Array.from(linhaSimples!.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['TXT · 3 MB', 'Arquivo guardado · aguardando preparação', 'Guardado · uso não autorizado'])
})

it('retirar a autorização de um item preparado só tira o dele do estado preparado', async () => {
  const outro = await seal('outro')
  items = [{ ...items[0]!, authorized: true }, { ...outro, authorized: true, createdAt: '' }]
  const sha256 = await materialHash(bytes)
  vi.mocked(local.listPreparedMaterials).mockResolvedValue([
    { materialId: 'material', ready: true, sha256, paragraphs: 1, preparedAt: '' },
    { materialId: 'outro', ready: true, sha256, paragraphs: 1, preparedAt: '' },
  ])
  vi.mocked(api.getMaterialContent).mockResolvedValue({ ok: true, ciphertext: material.contentCiphertext })
  mount()
  await waitFor(() => expect(screen.getAllByText('Pronto para selecionar na sessão')).toHaveLength(2))

  fireEvent.click(screen.getAllByRole('checkbox', { name: 'Autorizar nas minhas consultas' })[0]!)
  await screen.findByText('Autorização retirada. Este material não participa das suas consultas.')
  const [primeira, segunda] = screen.getAllByRole('listitem')
  expect(within(primeira!).getByText('Guardado · uso não autorizado')).toBeTruthy()
  expect(within(segunda!).getByText('Pronto para selecionar na sessão')).toBeTruthy()
})

it('preparo mostra indicador sem bloquear autorização ou ações da estante', async () => {
  const preparo = deferred<void>()
  vi.mocked(local.prepareLocalMaterial).mockReturnValueOnce(preparo.promise)
  mount(); await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Preparar arquivo' }))
  await screen.findByText('Organizando o conteúdo e preparando suas referências...')
  expect(document.querySelector('.preparation-spinner')).not.toBeNull()
  expect(screen.getByRole('checkbox', { name: 'Autorizar nas minhas consultas' })).toHaveProperty('disabled', false)
  expect(region('Materiais do acervo').getAttribute('aria-busy')).toBe('false')
  await act(async () => preparo.resolve())
  expect(screen.queryByText('Pronto para selecionar na sessão')).toBeNull()
})

it.each([['txt', 'text/plain;charset=utf-8'], ['pdf', 'application/pdf']] as const)('recupera o arquivo %s com o tipo e o conteúdo originais e o nome guardado', async (tipo, mime) => {
  const guardado = await seal('guardado', { type: tipo, filename: `guardado.${tipo}` })
  items = [{ ...guardado, authorized: true, createdAt: '' }]
  vi.mocked(api.getMaterialContent).mockResolvedValue({ ok: true, ciphertext: guardado.contentCiphertext })
  let nome = ''
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { nome = `${this.download}|${this.href}` })
  mount(); await screen.findByText('Obra guardado')
  fireEvent.click(screen.getByRole('button', { name: 'Recuperar arquivo' }))
  await screen.findByText('Arquivo recuperado e decifrado neste dispositivo.')
  const blob = vi.mocked(URL.createObjectURL).mock.lastCall![0] as Blob
  expect(blob.type).toBe(mime)
  expect(await blob.text()).toBe('Referência privada sintética.')
  expect(nome).toBe(`guardado.${tipo}|blob:private`)
})

it('excluir tira da lista só o material escolhido', async () => {
  const outro = await seal('outro')
  items = [items[0]!, { ...outro, authorized: false, createdAt: '' }]
  mount(); await screen.findByText('Obra outro')
  fireEvent.click(screen.getAllByRole('button', { name: 'Excluir material' })[0]!)
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
  await screen.findByText('Material excluído do seu acervo.')
  expect(screen.queryByText('Livro privado')).toBeNull()
  expect(screen.getByText('Obra outro')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Excluir material' })).toHaveLength(1)
})
