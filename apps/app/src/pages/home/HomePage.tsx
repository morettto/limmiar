import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Trans, useLingui } from '@lingui/react/macro'
import type { CryptoKey } from '@limmiar/crypto'
import { ESTADOS_VERIFICACAO } from '../../entities/account/account'
import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import { problemMessage, request } from '../../shared/api'
import { traduzir, type Texto } from '../../shared/i18n'
import { PainelProfissional } from '../../widgets/painel-profissional/PainelProfissional'
import { carregarBiblioteca } from '../../features/nota-biblioteca/carregar-biblioteca'
import type { Nota } from '../../entities/nota/nota'
import { ABA_NOTA } from '../../entities/atendimento/atendimento'

export interface HomePageProps {
  baseUrl: string
  chaveiro: { kek: CryptoKey; accountId: string; accessToken: string }
}

type Verificacao = 'Pending' | 'InReview' | 'Active' | 'Rejected'

export function HomePage({ baseUrl, chaveiro }: HomePageProps) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const [status, setStatus] = useState<Verificacao | null>(null)
  const [mensagem, setMensagem] = useState<Texto | null>(null)
  const [documento, setDocumento] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [versao, setVersao] = useState(0)
  const [versaoPainel, setVersaoPainel] = useState(0)
  const [notas, setNotas] = useState<readonly Nota[]>([])
  const [falhaNotas, setFalhaNotas] = useState<MessageDescriptor | null>(null)
  const [carregandoNotas, setCarregandoNotas] = useState(false)
  // Stryker disable next-line ArithmeticOperator: equivalent, a version counter only has to differ from the previous value.
  const atualizarPainel = () => setVersaoPainel(valor => valor + 1)
  // Stryker disable next-line ArithmeticOperator: equivalent, a version counter only has to differ from the previous value.
  const recarregar = () => setVersao(valor => valor + 1)
  const endpoint = `/accounts/${chaveiro.accountId}/professional-verification`

  useEffect(() => {
    let ativo = true
    async function carregar() {
      const resultado = await request(baseUrl, 'GET', endpoint, undefined, chaveiro.accessToken)
      if (!resultado.ok) {
        if (ativo) setMensagem(problemMessage(resultado.code, resultado.params))
        return
      }
      const body: unknown = await resultado.response.json()
      if (typeof body !== 'object' || body === null || !('status' in body) || !ESTADOS_VERIFICACAO.includes(body.status as Verificacao)) {
        if (ativo) setMensagem(msg`Resposta de verificação inválida.`)
        return
      }
      if (ativo) { setStatus(body.status as Verificacao); setMensagem(null) }
    }
    void carregar().catch((erro: unknown) => { if (ativo) setMensagem(erro instanceof Error ? erro.message : msg`Não foi possível carregar a conta.`) })
    return () => { ativo = false }
  }, [baseUrl, endpoint, chaveiro.accessToken, versao])

  useEffect(() => {
    if (status !== 'Active') return
    let ativo = true
    setCarregandoNotas(true); setNotas([]); setFalhaNotas(null)
    void carregarBiblioteca(baseUrl, chaveiro.accountId, chaveiro.accessToken, chaveiro.kek)
      .then(biblioteca => { if (ativo) setNotas(biblioteca.notas) })
      .catch(() => { if (ativo) setFalhaNotas(msg`Não foi possível carregar as notas pendentes. Tente novamente.`) })
      .finally(() => { if (ativo) setCarregandoNotas(false) })
    return () => { ativo = false }
  }, [status, baseUrl, chaveiro.accountId, chaveiro.accessToken, chaveiro.kek, versaoPainel])

  async function enviarDocumento(evento: React.FormEvent) {
    evento.preventDefault()
    setOcupado(true)
    setMensagem(null)
    try {
      const resultado = await request(baseUrl, 'POST', endpoint,
        { type: 'Document', documentReference: documento.trim() }, chaveiro.accessToken)
      if (!resultado.ok) {
        setMensagem(problemMessage(resultado.code, resultado.params))
        return
      }
      recarregar()
    } catch (erro) {
      setMensagem(erro instanceof Error ? erro.message : msg`Não foi possível enviar o documento.`)
    } finally { setOcupado(false) }
  }

  return <main id="app-shell" className="workspace">
    <header>
      <h1><Trans>Consultório</Trans></h1><p><Trans>Seu consultório, com privacidade.</Trans></p>
    </header>
    {mensagem !== null && <div><p role="alert">{traduzir(i18n, mensagem)}</p><button type="button" onClick={() => recarregar()}><Trans>Tentar novamente</Trans></button></div>}
    {status === null && mensagem === null && <p role="status"><Trans>Carregando sua conta...</Trans></p>}
    {status !== null && status !== 'Active' && <section className="workspace-card">
      <h2><Trans>Verificação profissional</Trans></h2>
      {status === 'InReview' ? <p><Trans>Documento recebido. Sua conta aguarda a aprovação da equipe.</Trans></p> :
        <form onSubmit={(e) => void enviarDocumento(e)}>
          <p><Trans>Envie a referência do documento profissional para revisão.</Trans></p>
          <label><Trans>Referência do documento</Trans><input required maxLength={500} value={documento} onChange={(e) => setDocumento(e.target.value)} /></label>
          <button type="submit" disabled={ocupado || !documento.trim()}><Trans>Enviar para revisão</Trans></button>
        </form>}
      <button type="button" disabled={ocupado} onClick={() => recarregar()}><Trans>Atualizar verificação</Trans></button>
    </section>}
    {status === 'Active' && <>
      <PainelProfissional baseUrl={baseUrl} chaveiro={chaveiro} notas={notas} versao={versaoPainel}
        onStart={(patientId, agendamento) => void navigate({ to: '/pacientes/$patientId', params: { patientId }, search: { agendamento } })}
        onOpenItem={(patientId, atendimentoId) => void (atendimentoId === undefined
          ? navigate({ to: '/pacientes/$patientId', params: { patientId } })
          : navigate({ to: '/pacientes/$patientId/sessoes/$atendimentoId', params: { patientId, atendimentoId }, search: { aba: ABA_NOTA } }))} />
      {carregandoNotas && <p role="status"><Trans>Carregando notas pendentes...</Trans></p>}
      {falhaNotas !== null && <div><p role="alert">{i18n._(falhaNotas)}</p><button type="button" onClick={atualizarPainel}><Trans>Tentar novamente</Trans></button></div>}
    </>}
  </main>
}
