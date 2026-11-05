import { useEffect, useId, useRef, useState } from 'react'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import type { CryptoKey } from '@limmiar/crypto'
import { authorizeMaterial, deleteMaterial, getMaterialContent, listMaterials, uploadMaterial, type MaterialAccess, type MaterialSummary } from '../../entities/material/api'
import { materialHash, materialType, openMaterialContent, openMaterialMetadata, sealMaterial, type MaterialMetadata, type MaterialType } from '../../entities/material/material-crypto'
import { readMaterialDetails } from '../../entities/material/material-details'
import { listPreparedMaterials, prepareLocalMaterial, removeLocalMaterial, type MaterialProgress } from '../../entities/material/local-material'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { translateProblemCode } from '../../shared/api'

const TITLE_MAX = 300
const AUTHORS_MAX = 500
interface OpenMaterial extends MaterialSummary { metadata: MaterialMetadata; dek: CryptoKey }
interface ChosenMaterial { filename: string; bytes: Uint8Array<ArrayBuffer>; type: MaterialType }
export interface AcervoPageProps extends MaterialAccess { kek: CryptoKey }

export function AcervoPage({ kek, ...access }: AcervoPageProps) {
  const { i18n, t } = useLingui()
  const [materials, setMaterials] = useState<OpenMaterial[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageDescriptor | null>(null)
  const [status, setStatus] = useState<MessageDescriptor | null>(null)
  const [version, setVersion] = useState(0)
  const [title, setTitle] = useState('')
  const [authors, setAuthors] = useState('')
  const [reference, setReference] = useState('')
  const [chosen, setChosen] = useState<ChosenMaterial | null>(null)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [ready, setReady] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [preparing, setPreparing] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const [capacityLimited, setCapacityLimited] = useState<Set<string>>(new Set())
  const inFlight = useRef(new Set<string>())
  const preparationAbort = useRef<AbortController | null>(null)
  const preparationState = useRef({ materials, ready, preparing, failed })
  preparationState.current = { materials, ready, preparing, failed }
  const [progress, setProgress] = useState<Map<string, MaterialProgress>>(new Map())
  const uploadInput = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const { baseUrl, accountId, accessToken } = access

  useEffect(() => {
    let active = true
    setLoading(true); setError(null)
    async function load() {
      const result = await listMaterials({ baseUrl, accountId, accessToken })
      // Stryker disable next-line ConditionalExpression: equivalent, reading `materials` off a failure throws into the same catch.
      if (!result.ok) throw new Error(result.code)
      const opened = await Promise.all(result.materials.map(async material => ({ ...material, ...await openMaterialMetadata(kek, accountId, material) })))
      const prepared = await listPreparedMaterials({ baseUrl, accountId, accessToken }).catch(() => null)
      if (active) {
        setMaterials(opened)
        setProgress(new Map(prepared?.flatMap(item => !item.ready && item.progress ? [[item.materialId, item.progress] as const] : [])))
        setReady(new Set(opened.filter(material => prepared?.some(item => item.materialId === material.materialId && item.ready && item.sha256 === material.metadata.sha256)).map(material => material.materialId)))
        setPreparing(previous => new Set([...previous, ...(prepared?.filter(item => !item.ready && item.stage !== 'falhou').map(item => item.materialId) ?? [])]
          .filter(id => !prepared?.some(item => item.materialId === id && (item.ready || item.stage === 'falhou')))))
        if (prepared) reconcileFailures(prepared)
      }
    }
    void load().catch(() => { if (active) setError(msg`Não foi possível abrir seu acervo. Tente novamente.`) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [baseUrl, accountId, accessToken, kek, version])

  useEffect(() => {
    if (preparing.size === 0) return
    let active = true
    const timer = setInterval(() => {
      void listPreparedMaterials({ baseUrl, accountId, accessToken }).then(prepared => {
        if (!active) return
        setProgress(new Map(prepared.flatMap(item => !item.ready && item.progress ? [[item.materialId, item.progress] as const] : [])))
        setReady(new Set(prepared.filter(item => item.ready).map(item => item.materialId)))
        setPreparing(new Set([...inFlight.current, ...prepared.filter(item => !item.ready && item.stage !== 'falhou').map(item => item.materialId)]))
        reconcileFailures(prepared)
      }).catch(() => { if (active) setError(msg`Não foi possível acompanhar o preparo. Tente novamente.`) })
    }, 1000)
    return () => { active = false; clearInterval(timer) }
  }, [baseUrl, accountId, accessToken, preparing.size])

  function reconcileFailures(prepared: Awaited<ReturnType<typeof listPreparedMaterials>>) {
    setFailed(previous => new Set([...previous].filter(id => !prepared.some(item => item.materialId === id)).concat(prepared.filter(item => !item.ready && item.stage === 'falhou').map(item => item.materialId))))
    setCapacityLimited(previous => new Set([...previous].filter(id => !prepared.some(item => item.materialId === id))))
  }

  useEffect(() => {
    let active = true
    const flights = inFlight.current
    let currentAbort: AbortController | null = null
    let working = false
    let retryAt = 0
    let delay = 1000
    async function next() {
      const state = preparationState.current
      if (working || state.preparing.size > 0 || Date.now() < retryAt) return
      const material = state.materials.toSorted((a, b) => Number(b.authorized) - Number(a.authorized) || a.createdAt.localeCompare(b.createdAt) || a.materialId.localeCompare(b.materialId)).find(item => !state.ready.has(item.materialId) && !state.failed.has(item.materialId))
      if (!material) return
      const id = material.materialId
      working = true
      const abort = new AbortController()
      currentAbort = abort
      preparationAbort.current = abort
      flights.add(id)
      setPreparing(previous => new Set([...previous, id]))
      setCapacityLimited(previous => new Set([...previous].filter(item => item !== id)))
      try {
        const downloaded = await getMaterialContent({ baseUrl, accountId, accessToken }, id)
        if (!downloaded.ok) throw new Error(downloaded.code)
        const bytes = await openMaterialContent(material.dek, accountId, id, downloaded.ciphertext)
        if (!active || abort.signal.aborted) return
        await prepareLocalMaterial({ baseUrl, accountId, accessToken }, id, material.metadata, bytes, abort.signal)
        delay = 1000
      } catch (error) {
        if (!active || abort.signal.aborted) return
        if (error instanceof Error && error.message === 'material.busy') {
          retryAt = Date.now() + delay
          delay = Math.min(delay * 2, 30_000)
          setCapacityLimited(previous => new Set([...previous, id]))
        } else setFailed(previous => new Set([...previous, id]))
        setPreparing(previous => new Set([...previous].filter(item => item !== id)))
      } finally {
        flights.delete(id)
        working = false
        if (preparationAbort.current === abort) preparationAbort.current = null
      }
    }
    const timer = setInterval(() => { void next() }, 1000)
    return () => { active = false; clearInterval(timer); currentAbort?.abort(); flights.clear() }
  }, [baseUrl, accountId, accessToken, kek])

  // Stryker disable next-line ArithmeticOperator: equivalent, a version counter only has to differ from the previous value.
  const recarregar = () => setVersion(value => value + 1)

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(null); setStatus(null)
    try { await action() }
    catch { setError(msg`Não foi possível concluir. Tente novamente.`) }
    finally { setBusy(false) }
  }

  async function content(material: OpenMaterial) {
    const result = await getMaterialContent(access, material.materialId)
    // Stryker disable next-line ConditionalExpression: equivalent, reading `ciphertext` off a failure throws into the same catch.
    if (!result.ok) throw new Error(translateProblemCode(result.code, result.params, i18n))
    return openMaterialContent(material.dek, accountId, material.materialId, result.ciphertext)
  }

  async function choose(selected: File | undefined) {
    setChosen(null); setTitle(''); setAuthors(''); setReference('')
    if (!selected) return
    await perform(async () => {
      setStatus(msg`Lendo os dados do documento...`)
      const bytes = new Uint8Array(await selected.arrayBuffer())
      let type: MaterialType
      try { type = materialType(selected.name, bytes) }
      catch { setStatus(null); uploadInput.current!.value = ''; setError(msg`Escolha um PDF válido ou texto UTF-8, com até 20 MB.`); return }
      const found = readMaterialDetails(selected.name, type, bytes)
      setTitle(found.title.slice(0, TITLE_MAX)); setAuthors(found.authors.slice(0, AUTHORS_MAX))
      setChosen({ filename: selected.name, bytes, type })
      setStatus(msg`Dados do documento carregados. Confira e ajuste antes de guardar.`)
    })
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault()
    if (!chosen) return
    await perform(async () => {
      setStatus(msg`Verificando e cifrando o material...`)
      const { bytes, filename, type } = chosen
      const metadata: MaterialMetadata = { title: title.trim(), authors: authors.trim(), reference: reference.trim(), filename, type, size: bytes.length, sha256: await materialHash(bytes) }
      const sealed = await sealMaterial(kek, accountId, crypto.randomUUID(), metadata, bytes)
      setStatus(msg`Enviando o material cifrado...`)
      const result = await uploadMaterial(access, sealed)
      if (!result.ok) throw new Error(translateProblemCode(result.code, result.params, i18n))
      setTitle(''); setAuthors(''); setReference(''); setChosen(null); uploadInput.current!.value = ''
      recarregar()
      setStatus(msg`Material guardado. Estamos preparando suas referências em segundo plano.`)
    })
  }

  async function authorize(material: OpenMaterial, authorized: boolean) {
    await perform(async () => {
      const result = await authorizeMaterial(access, material.materialId, authorized)
      if (!result.ok) throw new Error(translateProblemCode(result.code, result.params, i18n))
      setMaterials(previous => previous.map(item => item.materialId === material.materialId ? { ...item, authorized } : item))
      if (authorized) {
        setStatus(msg`Material disponível para selecionar nas suas sessões.`)
      } else {
        setStatus(msg`Autorização retirada. Este material não participa das suas consultas.`)
      }
    })
  }

  async function download(material: OpenMaterial) {
    await perform(async () => {
      const bytes = await content(material)
      const url = URL.createObjectURL(new Blob([bytes], { type: material.metadata.type === 'pdf' ? 'application/pdf' : 'text/plain;charset=utf-8' }))
      // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM element type, not visible copy.
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = material.metadata.filename; anchor.click()
      URL.revokeObjectURL(url)
      setStatus(msg`Arquivo recuperado e decifrado neste dispositivo.`)
    })
  }

  async function remove(material: OpenMaterial) {
    await perform(async () => {
      const result = await deleteMaterial(access, material.materialId)
      if (!result.ok) {
        if (result.code === 'materials.in_use') {
          setMaterials(previous => previous.map(item => item.materialId === material.materialId ? { ...item, inUse: true } : item))
          setError(msg`Este material está em uso em um atendimento. Encerre o atendimento antes de excluir.`)
          return
        }
        throw new Error(translateProblemCode(result.code, result.params, i18n))
      }
      if (inFlight.current.has(material.materialId)) preparationAbort.current?.abort()
      setPreparing(previous => new Set([...previous].filter(id => id !== material.materialId)))
      setMaterials(previous => previous.filter(item => item.materialId !== material.materialId)); setConfirmDelete(null)
      await removeLocalMaterial(access, material.materialId)
      setStatus(msg`Material excluído do seu acervo.`)
    })
  }

  const filtered = materials.filter(material => `${material.metadata.title} ${material.metadata.authors} ${material.metadata.reference}`.toLocaleLowerCase(i18n.locale).includes(query.toLocaleLowerCase(i18n.locale)))
  const totalPages = Math.max(1, Math.ceil(filtered.length / 10))
  const currentPage = Math.min(page, totalPages)
  const visible = filtered.slice((currentPage - 1) * 10, currentPage * 10)
  useEffect(() => { setPage(current => Math.min(current, totalPages)) }, [totalPages])
  return <main className="workspace acervo-page">
    <header className="professional-header"><div><p className="editorial-meta"><Trans>Bibliografia pessoal</Trans></p><h1><Trans>Seu acervo</Trans></h1>
      <p><Trans>Obras e materiais de referência para o seu trabalho clínico.</Trans></p></div></header>
    <section className="workspace-card" aria-label={t`Adicionar material`}>
      <h2><Trans>Adicionar material</Trans></h2><p><Trans>PDF ou texto UTF-8, até 20 MB. O arquivo é armazenado cifrado. Para preparar as referências, seu conteúdo é processado em memória pelo serviço do acervo.</Trans></p>
      {!chosen && <p id={hintId}><Trans>Escolha o arquivo primeiro. Título, autores e edição são lidos do documento e liberados para edição em seguida.</Trans></p>}
      <form className="material-form" aria-busy={busy} onSubmit={event => void upload(event)}>
        <label className="material-upload"><Trans>Arquivo do material</Trans><input ref={uploadInput} type="file" accept=".pdf,.txt,application/pdf,text/plain" disabled={busy} aria-describedby={chosen ? undefined : hintId} onChange={event => void choose(event.target.files?.[0])} /></label>
        <label><Trans>Título da obra</Trans><input required maxLength={TITLE_MAX} value={title} disabled={!chosen} aria-describedby={chosen ? undefined : hintId} onChange={event => setTitle(event.target.value)} /></label>
        <label><Trans>Autores</Trans><input required maxLength={AUTHORS_MAX} value={authors} disabled={!chosen} aria-describedby={chosen ? undefined : hintId} onChange={event => setAuthors(event.target.value)} /></label>
        <label className="material-reference"><Trans>Referência bibliográfica ou edição</Trans><input maxLength={1000} value={reference} disabled={!chosen} aria-describedby={chosen ? undefined : hintId} onChange={event => setReference(event.target.value)} /></label>
        <button type="submit" className="button-primary" disabled={busy || !title.trim() || !authors.trim()}><Trans>Guardar no acervo</Trans></button>
      </form>
    </section>
    {error !== null && <div><p role="alert">{i18n._(error)}</p><button type="button" disabled={busy} onClick={recarregar}><Trans>Tentar novamente</Trans></button></div>}
    {status !== null && <p role="status">{busy && <span className="preparation-spinner" aria-hidden="true" />}{i18n._(status)}</p>}
    <section className="workspace-card" aria-label={t`Materiais do acervo`} aria-busy={loading || busy}>
      <div className="professional-header"><h2><Trans>Materiais do acervo</Trans></h2><span className="editorial-meta"><Plural value={materials.length} _0="# materiais" one="# material" other="# materiais" /></span></div>
      <p><Trans>Os arquivos são preparados após o envio. Autorize as obras que poderão ser selecionadas em cada sessão.</Trans></p>
      <label><Trans>Buscar no acervo</Trans><input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} /></label>
      {loading ? <p role="status"><Trans>Abrindo seu acervo...</Trans></p> : materials.length === 0 ? <div className="editorial-empty"><h3><Trans>Uma estante para suas referências</Trans></h3><p><Trans>Adicione sua primeira obra. Depois, escolha os materiais que autoriza usar nas consultas.</Trans></p></div> : filtered.length === 0 ? <p><Trans>Nenhum material corresponde à busca.</Trans></p> :
        <ul className="material-list">{visible.map(material => <li key={material.materialId} className="material-row">
          <div><p className="editorial-meta">{material.metadata.type.toUpperCase()} · {new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 1 }).format(material.metadata.size / 1024 / 1024)} <Trans>MB</Trans></p><h3>{material.metadata.title}</h3>
            {material.metadata.authors && <p>{material.metadata.authors}</p>}{material.metadata.reference && <p>{material.metadata.reference}</p>}
            {preparing.has(material.materialId) ? <div role="status">{progress.has(material.materialId)
              ? <MaterialPreparationProgress progress={progress.get(material.materialId)!} />
              : <p><span className="preparation-spinner" aria-hidden="true" /><Trans>Organizando o conteúdo e preparando suas referências...</Trans></p>}</div>
              : capacityLimited.has(material.materialId) ? <p role="alert"><Trans>O serviço está preparando outros arquivos. Este arquivo está guardado, mas ainda não entrou na fila. O preparo será tentado novamente automaticamente.</Trans></p>
              : failed.has(material.materialId) ? <p role="alert"><Trans>Não foi possível preparar este arquivo.</Trans></p>
              : <p className="editorial-meta">{ready.has(material.materialId) ? t`Pronto para selecionar na sessão` : t`Arquivo guardado · aguardando preparação`}</p>}
            {!material.authorized && <p className="editorial-meta"><Trans>Guardado · uso não autorizado</Trans></p>}
            {material.inUse && <p className="editorial-meta"><Trans>Em uso em um atendimento</Trans></p>}
          </div><div className="material-actions">
            <label><input type="checkbox" disabled={busy || !ready.has(material.materialId)} checked={material.authorized} onChange={event => void authorize(material, event.target.checked)} /><Trans>Autorizar nas minhas consultas</Trans></label>
            {ready.has(material.materialId) && <button type="button" disabled={busy} onClick={() => void download(material)}><Trans>Recuperar arquivo</Trans></button>}
            {confirmDelete === material.materialId ? <div><p><Trans>Excluir permanentemente este material?</Trans></p><button type="button" disabled={busy || material.inUse} onClick={() => void remove(material)}><Trans>Confirmar exclusão</Trans></button><button type="button" disabled={busy} onClick={() => setConfirmDelete(null)}><Trans>Cancelar</Trans></button></div> :
              <button type="button" disabled={busy || material.inUse} onClick={() => setConfirmDelete(material.materialId)}><Trans>Excluir material</Trans></button>}
          </div>
        </li>)}</ul>}
      {filtered.length > 0 && <nav aria-label={t`Paginação do acervo`}>
        <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><Trans>Página anterior</Trans></button>
        <span><Trans>Página {currentPage} de {totalPages}</Trans></span>
        <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}><Trans>Próxima página</Trans></button>
      </nav>}
    </section>
  </main>
}

function MaterialPreparationProgress({ progress }: { progress: MaterialProgress }) {
  const { t } = useLingui()
  const { completed, total, phase } = progress
  return <div className="material-preparation">
    <p><span className="preparation-spinner" aria-hidden="true" />{phase === 'leitura' ? t`Lendo páginas: ${completed} de ${total}` : t`Preparando referências: ${completed} de ${total}`}</p>
    <progress value={completed} max={total} aria-label={t`Avanço da preparação`} />
    <span>{Math.floor(completed / total * 100)}%</span>
  </div>
}
