import { useEffect, useId, useRef, useState } from 'react'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import type { CryptoKey } from '@limmiar/crypto'
import { authorizeMaterial, deleteMaterial, getMaterialContent, listMaterials, uploadMaterial, type MaterialAccess, type MaterialSummary } from '../../entities/material/api'
import { materialHash, materialType, openMaterialContent, openMaterialMetadata, sealMaterial, type MaterialMetadata, type MaterialType } from '../../entities/material/material-crypto'
import { readMaterialDetails } from '../../entities/material/material-details'
import { listPreparedMaterials, prepareLocalMaterial, removeLocalMaterial } from '../../entities/material/local-material'
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
  const [query, setQuery] = useState('')
  const [ready, setReady] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
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
        setReady(new Set(opened.filter(material => material.authorized && prepared?.some(item => item.materialId === material.materialId && item.ready && item.sha256 === material.metadata.sha256)).map(material => material.materialId)))
      }
    }
    void load().catch(() => { if (active) setError(msg`Não foi possível abrir seu acervo. Tente novamente.`) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [baseUrl, accountId, accessToken, kek, version])

  // Stryker disable next-line ArithmeticOperator: equivalent, a version counter only has to differ from the previous value.
  const recarregar = () => setVersion(value => value + 1)

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(null); setStatus(null)
    try { await action() }
    catch (cause) {
      setError(cause instanceof Error && cause.message === 'material.prepare'
        ? msg`Material guardado. O serviço local não conseguiu prepará-lo; tente novamente quando estiver disponível.`
        : msg`Não foi possível concluir. Tente novamente.`)
    } finally { setBusy(false) }
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
      setStatus(msg`Material guardado no seu acervo. Autorize seu uso para prepará-lo nesta máquina.`)
    })
  }

  async function authorize(material: OpenMaterial, authorized: boolean) {
    await perform(async () => {
      const result = await authorizeMaterial(access, material.materialId, authorized)
      if (!result.ok) throw new Error(translateProblemCode(result.code, result.params, i18n))
      setMaterials(previous => previous.map(item => item.materialId === material.materialId ? { ...item, authorized } : item))
      setReady(previous => new Set([...previous].filter(id => id !== material.materialId)))
      if (authorized) {
        setStatus(msg`Preparando o material na sua máquina...`)
        await prepareLocalMaterial(access, material.materialId, material.metadata, await content(material))
        setReady(previous => new Set([...previous, material.materialId]))
        setStatus(msg`Material preparado nesta máquina para suas consultas.`)
      } else {
        await removeLocalMaterial(access, material.materialId)
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
      if (!result.ok) throw new Error(translateProblemCode(result.code, result.params, i18n))
      setMaterials(previous => previous.filter(item => item.materialId !== material.materialId)); setConfirmDelete(null)
      await removeLocalMaterial(access, material.materialId)
      setStatus(msg`Material excluído do seu acervo.`)
    })
  }

  const filtered = materials.filter(material => `${material.metadata.title} ${material.metadata.authors} ${material.metadata.reference}`.toLocaleLowerCase(i18n.locale).includes(query.toLocaleLowerCase(i18n.locale)))
  return <main className="workspace acervo-page">
    <header className="professional-header"><div><p className="editorial-meta"><Trans>Bibliografia pessoal</Trans></p><h1><Trans>Seu acervo</Trans></h1>
      <p><Trans>Obras e materiais de referência para o seu trabalho clínico.</Trans></p></div></header>
    <section className="workspace-card" aria-label={t`Adicionar material`}>
      <h2><Trans>Adicionar material</Trans></h2><p><Trans>PDF ou texto UTF-8, até 20 MB. Arquivo e dados bibliográficos são cifrados antes do envio.</Trans></p>
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
    {status !== null && <p role="status">{i18n._(status)}</p>}
    <section className="workspace-card" aria-label={t`Materiais do acervo`} aria-busy={loading || busy}>
      <div className="professional-header"><h2><Trans>Materiais do acervo</Trans></h2><span className="editorial-meta"><Plural value={materials.length} _0="# materiais" one="# material" other="# materiais" /></span></div>
      <p><Trans>A autorização é pessoal. Preparar um material libera sua consulta no serviço local; a qualidade do juiz clínico é verificada separadamente.</Trans></p>
      <label><Trans>Buscar no acervo</Trans><input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {loading ? <p role="status"><Trans>Abrindo seu acervo...</Trans></p> : materials.length === 0 ? <div className="editorial-empty"><h3><Trans>Uma estante para suas referências</Trans></h3><p><Trans>Adicione sua primeira obra. Depois, escolha os materiais que autoriza usar nas consultas.</Trans></p></div> : filtered.length === 0 ? <p><Trans>Nenhum material corresponde à busca.</Trans></p> :
        <ul className="material-list">{filtered.map(material => <li key={material.materialId} className="material-row">
          <div><p className="editorial-meta">{material.metadata.type.toUpperCase()} · {new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 1 }).format(material.metadata.size / 1024 / 1024)} <Trans>MB</Trans></p><h3>{material.metadata.title}</h3>
            {material.metadata.authors && <p>{material.metadata.authors}</p>}{material.metadata.reference && <p>{material.metadata.reference}</p>}
            <p className="editorial-meta">{ready.has(material.materialId) ? t`Preparado nesta máquina` : material.authorized ? t`Autorizado · requer preparação nesta máquina` : t`Guardado · uso não autorizado`}</p>
          </div><div className="material-actions">
            <label><input type="checkbox" disabled={busy} checked={material.authorized} onChange={event => void authorize(material, event.target.checked)} /><Trans>Autorizar nas minhas consultas</Trans></label>
            {material.authorized && !ready.has(material.materialId) && <button type="button" disabled={busy} onClick={() => void authorize(material, true)}><Trans>Preparar nesta máquina</Trans></button>}
            <button type="button" disabled={busy} onClick={() => void download(material)}><Trans>Recuperar arquivo</Trans></button>
            {confirmDelete === material.materialId ? <div><p><Trans>Excluir permanentemente este material?</Trans></p><button type="button" disabled={busy} onClick={() => void remove(material)}><Trans>Confirmar exclusão</Trans></button><button type="button" disabled={busy} onClick={() => setConfirmDelete(null)}><Trans>Cancelar</Trans></button></div> :
              <button type="button" disabled={busy} onClick={() => setConfirmDelete(material.materialId)}><Trans>Excluir material</Trans></button>}
          </div>
        </li>)}</ul>}
    </section>
  </main>
}
