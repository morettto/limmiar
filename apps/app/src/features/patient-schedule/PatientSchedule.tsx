import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { agendarSessao, cancelarSessao, listarSessoes, remarcarSessao } from '../../entities/agenda/api'
import type { SessaoAgendada } from '../../entities/agenda/sessao'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { translateProblemCode } from '../../shared/api'
import { traduzir, type Texto } from '../../shared/i18n'

interface Props {
  baseUrl: string
  accountId: string
  accessToken: string
  patientId: string
  /** Agendamentos que já têm sessão: remarcar ou cancelar os deixaria sem o encontro da sessão. */
  iniciadas: ReadonlySet<string>
  onChanged?(): void
}

function dataLocal(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}

function horarioLocal(iso: string): string {
  const data = new Date(iso)
  // eslint-disable-next-line lingui/no-unlocalized-strings -- ISO encoding for native datetime inputs.
  return `${dataLocal(data)}T${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`
}

export function PatientSchedule({ baseUrl, accountId, accessToken, patientId, iniciadas, onChanged }: Props) {
  const { i18n, t } = useLingui()
  const [dia, setDia] = useState(() => dataLocal(new Date()))
  const [sessoes, setSessoes] = useState<SessaoAgendada[]>([])
  const [inicio, setInicio] = useState('')
  const [duracao, setDuracao] = useState(50)
  const [editando, setEditando] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<Texto | null>(null)
  const [mensagem, setMensagem] = useState<MessageDescriptor | null>(null)

  useEffect(() => {
    let ativo = true
    setCarregando(true); setErro(null)
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Local midnight in an ISO timestamp.
    const de = new Date(`${dia}T00:00:00`)
    const ate = new Date(de.getTime() + 7 * 86400000)
    void listarSessoes(baseUrl, accountId, accessToken, de, ate).then(resultado => {
      if (!ativo) return
      // Stryker disable next-line ConditionalExpression: equivalent, reading `sessoes` off a failure throws into the same catch.
      if (!resultado.ok) throw new Error(resultado.code)
      setSessoes(resultado.sessoes.filter(sessao => sessao.patientId === patientId))
    }).catch(() => { if (ativo) { setSessoes([]); setErro(msg`Não foi possível carregar a agenda. Atualize para tentar novamente.`) } })
      .finally(() => { if (ativo) setCarregando(false) })
    return () => { ativo = false }
  }, [baseUrl, accountId, accessToken, patientId, dia, versao])

  // Stryker disable next-line ArithmeticOperator: equivalent, the version only has to differ from the previous one.
  const recarregar = () => setVersao(atual => atual + 1)

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault()
    setOcupado(true); setErro(null); setMensagem(null)
    try {
      const iso = new Date(inicio).toISOString()
      const resultado = editando === null
        ? await agendarSessao(baseUrl, accountId, accessToken, patientId, iso, duracao)
        : await remarcarSessao(baseUrl, accountId, accessToken, editando, iso, duracao)
      if (!resultado.ok) throw new Error(translateProblemCode(resultado.code, resultado.params, i18n))
      setMensagem(editando === null ? msg`Sessão agendada.` : msg`Sessão remarcada.`)
      setEditando(null); setInicio(''); recarregar()
      onChanged?.()
    } catch (falha) { setErro(falha instanceof Error ? falha.message : msg`Não foi possível salvar a sessão.`) }
    finally { setOcupado(false) }
  }

  async function cancelar(id: string) {
    setOcupado(true); setErro(null); setMensagem(null)
    try {
      const resultado = await cancelarSessao(baseUrl, accountId, accessToken, id)
      if (!resultado.ok) throw new Error(translateProblemCode(resultado.code, resultado.params, i18n))
      if (editando === id) { setEditando(null); setInicio('') }
      setMensagem(msg`Sessão cancelada.`); recarregar()
      onChanged?.()
    } catch (falha) { setErro(falha instanceof Error ? falha.message : msg`Não foi possível cancelar a sessão.`) }
    finally { setOcupado(false) }
  }

    return <section className="workspace-card" aria-label={t`Agenda deste paciente`}>
    <p className="editorial-meta"><Trans>Próximos encontros</Trans></p><h2><Trans>Agenda deste paciente</Trans></h2>
    <label><Trans>Semana a partir de</Trans><input type="date" required value={dia} disabled={ocupado} onChange={evento => { if (evento.target.value) setDia(evento.target.value) }} /></label>
    <button type="button" disabled={carregando || ocupado} onClick={() => recarregar()}><Trans>Atualizar agenda</Trans></button>
    {carregando && <p role="status"><Trans>Carregando sessões...</Trans></p>}
    {!carregando && erro === null && sessoes.length === 0 && <p><Trans>Nenhuma sessão agendada nesta semana.</Trans></p>}
    <ul>{sessoes.map(sessao => {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Date formatting options, not visible copy.
      const horario = i18n.date(new Date(sessao.inicioEm), { dateStyle: 'medium', timeStyle: 'short' })
      const minutos = sessao.duracaoMinutos
      return <li key={sessao.sessionId} className="patient-session">
      <p><time dateTime={sessao.inicioEm}>{horario}</time>{' · '}<Trans>{minutos} minutos</Trans></p>
      {iniciadas.has(sessao.sessionId) ? <p className="editorial-meta"><Trans>Sessão iniciada</Trans></p> : <div className="flex flex-wrap gap-3">
        <button type="button" disabled={ocupado} onClick={() => { setEditando(sessao.sessionId); setInicio(horarioLocal(sessao.inicioEm)); setDuracao(sessao.duracaoMinutos); setMensagem(null); setErro(null) }}><Trans>Remarcar sessão</Trans></button>
        <button type="button" className="button-secondary" disabled={ocupado} onClick={() => void cancelar(sessao.sessionId)}><Trans>Cancelar sessão</Trans></button>
      </div>}
    </li>})}</ul>
    <form onSubmit={evento => void salvar(evento)}>
      <h3>{editando === null ? t`Agendar próximo encontro` : t`Novo horário da sessão`}</h3>
      <label><Trans>Data e horário</Trans><input type="datetime-local" required value={inicio} disabled={ocupado} onChange={evento => setInicio(evento.target.value)} /></label>
      <label><Trans>Duração em minutos</Trans><input type="number" required min={1} max={1440} value={duracao} disabled={ocupado} onChange={evento => setDuracao(evento.target.valueAsNumber)} /></label>
      <button type="submit" disabled={ocupado || !inicio || !Number.isInteger(duracao) || duracao < 1 || duracao > 1440}>{editando === null ? t`Agendar sessão` : t`Salvar novo horário`}</button>
      {editando !== null && <button type="button" className="button-secondary" disabled={ocupado} onClick={() => { setEditando(null); setInicio('') }}><Trans>Voltar a agendar</Trans></button>}
    </form>
    {mensagem !== null && <p role="status">{i18n._(mensagem)}</p>}{erro !== null && <p role="alert">{traduzir(i18n, erro)}</p>}
  </section>
}
