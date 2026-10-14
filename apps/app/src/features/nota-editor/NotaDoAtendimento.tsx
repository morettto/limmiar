import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { CryptoKey } from '@limmiar/crypto'
import { appendPatientEntry, getPatientRecord } from '../../entities/patient/api'
import { sealEntry } from '../../entities/patient/patient-crypto'
import { ORDEM_SECOES, ESTADO_PENDENTE, ESTADO_ASSINADA, type Nota } from '../../entities/nota/nota'
import { notaParaEntrada, selarAssinatura } from '../../entities/nota/nota-crypto'
import { assinarNota } from '../../entities/nota/api'
import { adicionarReferencia, type PropostaReferencia } from '../../entities/nota/referencia'
import type { Transcricao } from '../../entities/transcricao/transcricao'
import { msg } from '@lingui/core/macro'
import { translateProblemCode } from '../../shared/api'
import { traduzir, type Texto } from '../../shared/i18n'
import { EditorSoap } from './EditorSoap'

export interface NotaDoAtendimentoProps {
  baseUrl: string
  accountId: string
  accessToken: string
  patientId: string
  atendimentoId: string
  dek: CryptoKey
  /** A nota já gravada desta sessão (uma por sessão); sem ela, abre uma nota em branco. */
  nota?: Nota
  /** Só as revisões da transcrição desta sessão: a referência é validada contra elas. */
  transcricoes: readonly Transcricao[]
  analiseAutorizada: boolean
  /** A aba da nota está à vista: a proposta de referência só recebe o foco então. */
  ativa: boolean
  propostaReferencia: PropostaReferencia | null
  onDescartarProposta(): void
  onAbrirTranscricao(): void
  onSaved(): void
  prepararSalvamento?(salvar: () => Promise<void>): void
  bloqueada?: boolean
}

function papelDe(transcricao: Transcricao, locutor: string | null) {
  // Stryker disable next-line ConditionalExpression: equivalent, `papeis[null]` is undefined, which is not 'paciente' either.
  return locutor === null ? null : transcricao.papeis[locutor]
}

function novaNota(patientId: string, atendimentoId: string): Nota {
  return { id: crypto.randomUUID(), patientId, atendimentoId, revisao: 0, estado: ESTADO_PENDENTE,
    frases: ORDEM_SECOES.map((secao) => ({ id: `${secao}-0`, secao, texto: '', ancoras: [] })) }
}

export function NotaDoAtendimento({ baseUrl, accountId, accessToken, patientId, atendimentoId, dek, nota: gravada, transcricoes, analiseAutorizada, ativa, propostaReferencia, onDescartarProposta, onAbrirTranscricao, onSaved, prepararSalvamento, bloqueada = false }: NotaDoAtendimentoProps) {
  const { i18n, t } = useLingui()
  const [nota, setNota] = useState<Nota>(() => gravada ?? novaNota(patientId, atendimentoId))
  const [ocupado, setOcupado] = useState(false)
  const [mensagem, setMensagem] = useState<Texto | null>(null)
  const revisaoGravada = useRef(gravada?.revisao)
  const propostaRef = useRef<HTMLFormElement>(null)
  const accessTokenRef = useRef(accessToken)
  accessTokenRef.current = accessToken
  const salvarRascunho = useRef<() => Promise<void>>(null)
  salvarRascunho.current = () => gravar(false, true)
  useEffect(() => { prepararSalvamento?.(() => salvarRascunho.current!()) }, [prepararSalvamento])

  useEffect(() => {
    if (propostaReferencia && ativa) {
      propostaRef.current!.focus()
      // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM scrolling options.
      propostaRef.current!.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    }
  }, [propostaReferencia, ativa])

  async function gravar(assinar: boolean, propagarErro = false) {
    // Stryker disable next-line ConditionalExpression: equivalent, the buttons and the editor shortcut already refuse a signed note.
    if (nota.estado === ESTADO_ASSINADA) return
    const atual = nota
    setOcupado(true); setMensagem(null)
    try {
      if (revisaoGravada.current !== atual.revisao) {
        const registro = await getPatientRecord(baseUrl, accountId, accessTokenRef.current, patientId)
        if (!registro.ok) throw new Error(translateProblemCode(registro.code, registro.params, i18n))
        const sequence = registro.entries.length + 1
        const ciphertext = await sealEntry(dek, patientId, sequence, notaParaEntrada(atual))
        const salvo = await appendPatientEntry(baseUrl, accountId, accessTokenRef.current, patientId, { sequence, ciphertext })
        if (!salvo.ok) throw new Error(translateProblemCode(salvo.code, salvo.params, i18n))
        revisaoGravada.current = atual.revisao
      }
      if (assinar) {
        const signature = await selarAssinatura(dek, atual.id, atual)
        const resultado = await assinarNota(baseUrl, accountId, accessTokenRef.current, atual.id, { revision: atual.revisao, signature })
        if (!resultado.ok) throw new Error(translateProblemCode(resultado.code, resultado.params, i18n))
        setNota({ ...atual, estado: ESTADO_ASSINADA })
        setMensagem(msg`Nota assinada e salva no prontuário.`)
      } else setMensagem(msg`Nota salva no prontuário.`)
      onSaved()
    } catch (erro) {
      setMensagem(erro instanceof Error ? erro.message : msg`Não foi possível concluir. Tente novamente.`)
      if (propagarErro) throw erro
    } finally { setOcupado(false) }
  }

  const transcricaoDaProposta = transcricoes.findLast(item => item.id === propostaReferencia?.referencia.transcriptId)
  // Só roda com proposta: sem ela `transcricaoDaProposta` nem existe.
  const palavrasDaProposta = transcricaoDaProposta?.palavras.filter(palavra => palavra.inicioMs >= propostaReferencia!.inicioMs &&
    palavra.fimMs <= propostaReferencia!.fimMs && papelDe(transcricaoDaProposta, palavra.locutor) === 'paciente') ?? []
  const propostaValida = propostaReferencia && propostaReferencia.patientId === patientId && analiseAutorizada &&
    transcricaoDaProposta?.revisao === propostaReferencia.referencia.revisaoTranscricao &&
    palavrasDaProposta[0]?.inicioMs === propostaReferencia.inicioMs && palavrasDaProposta.at(-1)?.fimMs === propostaReferencia.fimMs &&
    palavrasDaProposta.map(palavra => palavra.texto).join(' ') === propostaReferencia.referencia.frasePaciente
  const podeAdicionarReferencia = propostaValida && nota.estado !== ESTADO_ASSINADA && !ocupado && !bloqueada

  function confirmarReferencia() {
    if (!podeAdicionarReferencia) return
    const frasePaciente = propostaReferencia.referencia.frasePaciente
    setNota(adicionarReferencia(nota, propostaReferencia, t`Referência selecionada para a fala: ${frasePaciente}`))
    onDescartarProposta()
    setMensagem(msg`Referência incluída no rascunho. Confira a avaliação antes de salvar ou assinar.`)
  }

  function abrirTranscricao(transcriptId: string, revisao: number) {
    if (transcricoes.some(item => item.id === transcriptId && item.revisao === revisao)) onAbrirTranscricao()
    else setMensagem(msg`Não foi possível abrir a transcrição desta referência.`)
  }

  return <section className="workspace-card" aria-label={t`Nota da sessão`}>
    <h2><Trans>Nota da sessão</Trans></h2>
    {mensagem !== null && <p role="status">{traduzir(i18n, mensagem)}</p>}
    {propostaReferencia && <form ref={propostaRef} tabIndex={-1} className="editorial-card" aria-label={t`Referência para aprovação`} onSubmit={evento => { evento.preventDefault(); confirmarReferencia() }}>
      <h4><Trans>Revisar referência antes de incluir</Trans></h4>
      <p>{propostaReferencia.referencia.frasePaciente}</p>
      <p>{propostaReferencia.referencia.autor} · {propostaReferencia.referencia.titulo}</p>
      <blockquote>{propostaReferencia.referencia.citacaoLiteral}</blockquote>
      {!propostaValida && <p role="status"><Trans>A referência não corresponde à revisão atual de uma fala autorizada deste paciente.</Trans></p>}
      <p><Trans>A confirmação adiciona a referência à avaliação desta nota. Nenhum diagnóstico é preenchido automaticamente.</Trans></p>
      <button type="submit" disabled={!podeAdicionarReferencia}><Trans>Confirmar referência na avaliação</Trans></button>
      <button type="button" onClick={onDescartarProposta}><Trans>Descartar referência</Trans></button>
    </form>}
    <fieldset className="note-editor-controls" aria-label={t`Nota da sessão`} disabled={ocupado || bloqueada}>
      <EditorSoap nota={nota} onChange={setNota} aoAssinar={() => { if (!ocupado && !bloqueada) void gravar(true) }} aoAbrirTranscricao={abrirTranscricao} />
    </fieldset>
    <div className="flex gap-2"><button type="button" className="button-primary" disabled={ocupado || bloqueada || nota.estado === ESTADO_ASSINADA} onClick={() => void gravar(false)}><Trans>Salvar nota</Trans></button>
      <button type="button" disabled={ocupado || bloqueada || nota.estado === ESTADO_ASSINADA} onClick={() => void gravar(true)}><Trans>Assinar nota</Trans></button></div>
  </section>
}
