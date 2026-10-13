import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import type { CryptoKey } from '@limmiar/crypto'
import { createPatient, listPatients } from '../../entities/patient/api'
import { sealNewPatient } from '../../entities/patient/patient-crypto'
import { decryptSummaries } from '../../entities/patient/decrypt-summaries'
import type { PatientRisk, SummaryResult } from '../../entities/patient/patient-summary'
import { msg } from '@lingui/core/macro'
import { problemMessage, translateProblemCode } from '../../shared/api'
import { traduzir, type Texto } from '../../shared/i18n'

const DEFAULT_RISK: PatientRisk = 'baixo'

export interface PatientListProps {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
  onChanged?(): void
}

export function PatientList({ baseUrl, accountId, accessToken, kek, onChanged }: PatientListProps) {
  const { i18n, t } = useLingui()
  const [pacientes, setPacientes] = useState<SummaryResult[]>([])
  const [nome, setNome] = useState('')
  const [busca, setBusca] = useState('')
  const [risco, setRisco] = useState<PatientRisk>(DEFAULT_RISK)
  const [ocupado, setOcupado] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [mensagem, setMensagem] = useState<Texto | null>(null)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    async function carregar() {
      const resultado = await listPatients(baseUrl, accountId, accessToken)
      if (!resultado.ok) {
        if (ativo) setMensagem(problemMessage(resultado.code, resultado.params))
        return
      }
      const resumos = await decryptSummaries(kek, resultado.patients)
      if (ativo) setPacientes(resumos)
    }
    void carregar().catch((erro: unknown) => { if (ativo) setMensagem(erro instanceof Error ? erro.message : msg`Não foi possível carregar os pacientes.`) }).finally(() => { if (ativo) setCarregando(false) })
    return () => { ativo = false }
  }, [baseUrl, accountId, accessToken, kek, versao])

  async function adicionar(evento: React.FormEvent) {
    evento.preventDefault()
    setOcupado(true)
    setMensagem(null)
    try {
      const patientId = crypto.randomUUID()
      const selado = await sealNewPatient(kek, patientId, new TextEncoder().encode(JSON.stringify({ name: nome.trim(), risk: risco })))
      const resultado = await createPatient(baseUrl, accountId, accessToken, { patientId, ...selado })
      if (!resultado.ok) throw new Error(translateProblemCode(resultado.code, resultado.params, i18n))
      setNome('')
      // Stryker disable next-line ArithmeticOperator: equivalent, the version only has to differ from the previous one.
      setVersao((valor) => valor + 1)
      onChanged?.()
    } catch (erro) {
      setMensagem(erro instanceof Error ? erro.message : msg`Não foi possível concluir. Tente novamente.`)
    } finally { setOcupado(false) }
  }

  const visiveis = pacientes.filter(paciente => !paciente.ok || paciente.name.toLocaleLowerCase(i18n.locale).includes(busca.toLocaleLowerCase(i18n.locale)))
  return <section className="workspace-card" aria-label={t`Pacientes`}>
    <div className="professional-header"><div><p className="editorial-meta"><Trans>Carteira profissional</Trans></p><h2><Trans>Pacientes</Trans></h2></div><span className="editorial-meta"><Plural value={pacientes.length} _0="# pastas" one="# pasta" other="# pastas" /></span></div>
    <details className="patient-add"><summary><Trans>Adicionar paciente</Trans></summary>
    <form onSubmit={(evento) => void adicionar(evento)} className="flex flex-wrap items-end gap-3">
      <label><Trans>Nome do paciente</Trans><input required maxLength={200} value={nome} onChange={(e) => setNome(e.target.value)} /></label>
      <label><Trans>Risco avaliado pelo profissional</Trans><select value={risco} onChange={(e) => setRisco(e.target.value as PatientRisk)}>
        <option value="baixo"><Trans>Baixo</Trans></option><option value="moderado"><Trans>Moderado</Trans></option><option value="elevado"><Trans>Elevado</Trans></option>
      </select></label>
      <button disabled={ocupado || !nome.trim()} type="submit"><Trans>Adicionar paciente</Trans></button>
    </form></details>
    {mensagem !== null && <p role="status">{traduzir(i18n, mensagem)}</p>}
    <label className="patient-search"><Trans>Buscar paciente nesta carteira</Trans><input type="search" value={busca} onChange={evento => setBusca(evento.target.value)} /></label>
    {carregando && <p role="status"><Trans>Abrindo sua carteira...</Trans></p>}
    {!carregando && pacientes.length > 0 && visiveis.length === 0 && <p><Trans>Nenhum paciente corresponde à busca.</Trans></p>}
    <ul className="patient-folders">{visiveis.map((paciente) => <li key={paciente.patientId}>
      {paciente.ok
        ? <Link to="/pacientes/$patientId" params={{ patientId: paciente.patientId }} className="patient-folder"><FolderIcon /><span>{paciente.name}</span></Link>
        : <span className="patient-folder" aria-disabled="true"><FolderIcon /><span>{t`Não foi possível ler o paciente`}</span></span>}
    </li>)}</ul>
    {!carregando && pacientes.length === 0 && <p><Trans>Adicione seu primeiro paciente para abrir o prontuário.</Trans></p>}
  </section>
}

function FolderIcon() {
  return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 7V4h7l2 3h9v13H3V7Z" stroke="currentColor" strokeWidth="1.2" /></svg>
}
