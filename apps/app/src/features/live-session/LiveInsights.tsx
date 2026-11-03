import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import type { PalavraAtribuida, RotuloLocutor } from '@limmiar/diarization'
import { consultarInsight, type BibliografiaInsight, type ConsultaInsight, type FonteInsight, type ResultadoInsight } from '../../entities/insight/insight'
import { criarFilaInsights } from '../../entities/insight/fila-insights'
import { selecionarFalasPaciente } from '../../entities/insight/falas-paciente'
import { selecionarTurnosPaciente } from '../../entities/insight/turnos-paciente'
import { montarLinhasTranscricao } from '../../entities/insight/linhas-transcricao'
import { formatarInstante, montarBlocos } from '../../entities/insight/blocos-transcricao'
import { guardarVoto, lerVotos, type Voto } from '../../entities/insight/voto-store'
import { gravarConsentimento, lerConsentimento, type ConsentimentoVoto } from '../../entities/insight/consentimento-voto'
import { enviarPendentes } from '../../entities/insight/voto-envio'
import './transcricao.css'

// Sublinhado leve só quando a fala tem apenas possíveis; aviso de risco ou de esclarecimento mantém o forte.
const soPossiveis = ({ cartoes, clarificar, alerta_risco }: ResultadoInsight) =>
  !clarificar && !alerta_risco && cartoes.every((fonte) => fonte.nivel === 'possivel')

interface Props {
  palavras: PalavraAtribuida[]
  palavrasFinais?: PalavraAtribuida[]
  palavrasHipotese?: PalavraAtribuida[]
  papeis: Record<string, RotuloLocutor | null>
  estavelAteMs: number
  // Quantas palavras são finais; as seguintes são hipótese do servidor e aparecem em tom mais claro. Só vem durante a gravação.
  finais?: number
  autorizada: boolean
  onOuvir?: (inicioMs: number) => void
  trilhasSeparadas?: boolean
  bibliografia?: BibliografiaInsight
  temObrasAutorizadas?: boolean
  votos?: { accountId: string; kek: CryptoKey }
  onSelectFonte?(consulta: ConsultaInsight, fonte: FonteInsight, inicioMs: number, fimMs: number): void
}

export function LiveInsights({ palavras, palavrasFinais, palavrasHipotese, papeis, estavelAteMs, finais, autorizada, onOuvir, trilhasSeparadas, bibliografia, votos, onSelectFonte, temObrasAutorizadas }: Props) {
  const { t } = useLingui()
  const prefixo = useId()
  const chaveBibliografia = bibliografia ? JSON.stringify([bibliografia.accountId, [...bibliografia.materialIds].sort()]) : undefined
  const bibliografiaAtual = useRef(bibliografia)
  bibliografiaAtual.current = bibliografia
  const semMateriais = bibliografia?.materialIds.length === 0
  const finaisAtuais = useMemo(() => palavrasFinais ?? (finais === undefined ? palavras : palavras.slice(0, finais)), [palavrasFinais, palavras, finais])
  const hipoteseAtual = useMemo(() => palavrasHipotese ?? (finais === undefined ? [] : palavras.slice(finais)), [palavrasHipotese, palavras, finais])
  const locutoresFinais = useMemo(() => [...new Set(finaisAtuais.flatMap(palavra => palavra.locutor === null ? [] : [palavra.locutor]))], [finaisAtuais])
  const papeisFinaisAnterior = useRef<Record<string, RotuloLocutor | null>>({})
  const papeisFinais = useMemo(() => {
    const novos = Object.fromEntries(locutoresFinais.map(locutor => [locutor, papeis[locutor] ?? null]))
    const anteriores = papeisFinaisAnterior.current
    const mesmasChaves = Object.keys(novos).length === Object.keys(anteriores).length && Object.entries(novos).every(([locutor, papel]) => anteriores[locutor] === papel)
    if (mesmasChaves) return anteriores
    papeisFinaisAnterior.current = novos
    return novos
  }, [locutoresFinais, papeis])
  const aoVivo = finais !== undefined
  const consultas = useMemo(() => {
    if (!autorizada || semMateriais) return []
    // Stryker disable next-line ConditionalExpression: equivalent, `papeis[null]` is undefined, which is not 'paciente' either.
    const doPaciente = trilhasSeparadas ? finaisAtuais.filter(palavra => palavra.locutor !== null && papeisFinais[palavra.locutor] === 'paciente') : finaisAtuais
    const falas = selecionarFalasPaciente(doPaciente, papeisFinais, estavelAteMs)
    // Ao vivo, a passada da fala inteira tomaria a vez das frases novas; ela fica para depois da gravação.
    return aoVivo ? falas : [...falas, ...selecionarTurnosPaciente(doPaciente, papeisFinais, estavelAteMs, falas)]
  }, [finaisAtuais, papeisFinais, estavelAteMs, autorizada, trilhasSeparadas, semMateriais, aoVivo])
  const montarLinhas = useCallback((palavrasDaParte: PalavraAtribuida[], papeisDaParte: Record<string, RotuloLocutor | null>,
    consultasDaParte: ConsultaInsight[], quantidadeFinal = palavrasDaParte.length) => {
    if (!trilhasSeparadas) return montarLinhasTranscricao(palavrasDaParte, papeisDaParte, consultasDaParte, quantidadeFinal)
    const fontes = new Map<string | null, PalavraAtribuida[]>()
    palavrasDaParte.forEach(palavra => {
      if (!fontes.has(palavra.locutor)) fontes.set(palavra.locutor, [])
      fontes.get(palavra.locutor)!.push(palavra)
    })
    return [...fontes.values()].flatMap(fonte => montarLinhasTranscricao(fonte, papeisDaParte, consultasDaParte,
      Math.min(quantidadeFinal, fonte.length))).sort((a, b) => a.inicioMs - b.inicioMs)
  }, [trilhasSeparadas])
  const linhasFinais = useMemo(() => montarLinhas(finaisAtuais, papeisFinais, consultas), [finaisAtuais, papeisFinais, consultas, montarLinhas])
  const linhasHipotese = useMemo(() => montarLinhas(hipoteseAtual, papeis, [], 0), [hipoteseAtual, papeis, montarLinhas])
  const blocosFinais = useMemo(() => montarBlocos(linhasFinais, finaisAtuais), [linhasFinais, finaisAtuais])
  const blocosHipotese = useMemo(() => montarBlocos(linhasHipotese, hipoteseAtual), [linhasHipotese, hipoteseAtual])
  const blocos = useMemo(() => {
    const resultado = [...blocosFinais]
    for (const hipotese of blocosHipotese) {
      const ultimo = resultado.at(-1)
      const ultimaLinha = ultimo?.linhas.at(-1)
      const primeiraLinha = hipotese.linhas[0]
      const mesmoTurno = ultimo && ultimaLinha && primeiraLinha &&
        (ultimo.papel === 'voce' ? hipotese.papel === 'voce' : ultimo.papel === hipotese.papel && ultimaLinha.locutor === primeiraLinha.locutor) &&
        primeiraLinha.inicioMs >= ultimaLinha.fimMs
      if (mesmoTurno) {
        resultado[resultado.length - 1] = { ...ultimo, falaMs: ultimo.falaMs + hipotese.falaMs,
          linhas: [...ultimo.linhas, ...hipotese.linhas] }
      } else {
        const indice = resultado.findIndex(bloco => bloco.inicioMs > hipotese.inicioMs)
        resultado.splice(indice < 0 ? resultado.length : indice, 0, hipotese)
      }
    }
    return resultado.map(bloco => ({ ...bloco, parcial: bloco.linhas.every(linha => linha.parcial) }))
  }, [blocosFinais, blocosHipotese])
  const [resultados, setResultados] = useState<Record<string, { resultado: ResultadoInsight; chave: string } | null>>({})
  const [aberta, setAberta] = useState<string | null>(null)
  const baloes = useRef(new Map<string, HTMLDetailsElement>())
  const botoes = useRef(new Map<string, HTMLButtonElement>())
  const [votados, setVotados] = useState<Record<string, Voto>>({})
  const chaveVoto = (fala: string, trecho: string, juiz: string) => JSON.stringify([fala, trecho, juiz])
  useEffect(() => {
    if (!votos) return
    let ativa = true
    void lerVotos(votos.kek, votos.accountId).then(eventos => {
      if (ativa) setVotados(Object.fromEntries(eventos.map(evento => [chaveVoto(evento.fala, evento.trecho, evento.juiz), evento.voto])))
    })
    return () => { ativa = false }
  }, [votos])
  const [consentimento, setConsentimento] = useState<ConsentimentoVoto | null>(() => votos ? lerConsentimento(votos.accountId) : null)
  const [pergunta, setPergunta] = useState<{ consulta: ConsultaInsight; fonte: FonteInsight; juiz: string; voto: Voto } | null>(null)
  useEffect(() => {
    if (votos) void enviarPendentes(votos.kek, votos.accountId, bibliografia)
  }, [votos, bibliografia])
  async function votar(consulta: ConsultaInsight, fonte: FonteInsight, juiz: string, voto: Voto, atual = consentimento) {
    await guardarVoto(votos!.kek, votos!.accountId, { fala: consulta.frase, contexto: consulta.contexto, trecho: fonte.citacao_literal, obra: fonte.titulo, voto, juiz }, atual === 'sim')
    setVotados(anteriores => ({ ...anteriores, [chaveVoto(consulta.frase, fonte.citacao_literal, juiz)]: voto }))
    if (atual === null) setPergunta({ consulta, fonte, juiz, voto })
    await enviarPendentes(votos!.kek, votos!.accountId, bibliografia)
  }
  async function responder(valor: ConsentimentoVoto) {
    gravarConsentimento(votos!.accountId, valor)
    setConsentimento(valor)
    const { consulta, fonte, juiz, voto } = pergunta!
    setPergunta(null)
    if (valor === 'sim') await votar(consulta, fonte, juiz, voto, valor)
  }
  const [servico, setServico] = useState<'nao_liberado' | 'fora' | null>(null)
  const [semAnalise, setSemAnalise] = useState<Record<string, string>>({})
  const fila = useRef<ReturnType<typeof criarFilaInsights> | null>(null)
  useEffect(() => {
    setResultados({}); setServico(null); setSemAnalise({})
    const atual = criarFilaInsights((consulta, signal) => consultarInsight(consulta, signal, bibliografiaAtual.current), (id, resultado, consulta) => {
      setResultados((anteriores) => ({ ...anteriores, [id]: resultado ? { resultado, chave: JSON.stringify(consulta) } : null }))
      if (resultado) setServico(null)
    }, (falha, consulta) => {
      if (falha === 'sem_analise') setSemAnalise((anteriores) => ({ ...anteriores, [consulta.id]: JSON.stringify(consulta) }))
      else setServico(falha)
    })
    fila.current = atual
    return () => atual.encerrar()
  }, [chaveBibliografia])
  useEffect(() => { fila.current!.atualizar(consultas, aoVivo ? estavelAteMs : undefined) }, [consultas, chaveBibliografia, aoVivo, estavelAteMs])
  const porId = new Map(consultas.map((consulta) => [consulta.id, consulta]))
  const vigente = (consulta: ConsultaInsight | undefined) => {
    const salvo = consulta && resultados[consulta.id]
    return salvo && salvo.chave === JSON.stringify(consulta) ? salvo.resultado : undefined
  }
  // Cada trecho aparece uma vez na sessão, na fala que o mostrou primeiro (ordem de chegada das respostas):
  // a fala adiada respondida depois não tira da tela um balão que o profissional já viu.
  const donos = new Map<string, string>()
  for (const id of Object.keys(resultados)) {
    for (const fonte of vigente(porId.get(id))?.cartoes ?? []) if (!donos.has(fonte.trecho_id)) donos.set(fonte.trecho_id, id)
  }
  const qualificados = new Map(consultas.flatMap((consulta) => {
    const salvo = vigente(consulta)
    if (!salvo) return []
    const resultado = { ...salvo, cartoes: salvo.cartoes.filter((fonte) => donos.get(fonte.trecho_id) === consulta.id) }
    return resultado.cartoes.length > 0 || resultado.clarificar || resultado.alerta_risco ? [[consulta.id, { consulta, resultado }] as const] : []
  }))
  const semAnaliseIds = new Set<string | null>(consultas.filter((consulta) => semAnalise[consulta.id] === JSON.stringify(consulta)).map((consulta) => consulta.id))
  // Stryker disable next-line ConditionalExpression: equivalent, `qualificados.get(null)` is undefined and no `ancoras` includes null.
  const insightDaLinha = (consultaId: string | null) => consultaId === null ? undefined
    : qualificados.get(consultaId) ?? [...qualificados.values()].find(({ consulta }) => consulta.ancoras?.includes(consultaId))
  function abrir(id: string) {
    setAberta(JSON.stringify(qualificados.get(id)!.consulta))
    const balao = baloes.current.get(id)!
    balao.open = true
    balao.querySelector('summary')!.focus()
    // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM scroll options, not visible copy.
    balao.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }
  return <div className="session-reading">
    <section className="transcript-paper" aria-label={t`Transcrição ao vivo`}>
      <p className="editorial-eyebrow"><Trans>Palavra por palavra</Trans></p>
      <h3><Trans>Transcrição ao vivo</Trans></h3>
      {linhasFinais.length + linhasHipotese.length === 0 && <p><Trans>A fala aparecerá aqui durante a sessão.</Trans></p>}
      <ol className="transcript-blocks">{blocos.map((bloco) => {
        const segundos = (bloco.inicioMs / 1000).toFixed(1)
        const duracao = formatarInstante(bloco.falaMs)
        const numero = bloco.pessoa
        const nome = bloco.papel === 'voce' ? t`Profissional` : bloco.papel === 'paciente' ? t`Paciente` : numero === null ? t`Voz não identificada` : t`Pessoa ${numero}`
        return <li key={`${bloco.parcial ? 'parcial' : 'final'}:${bloco.id}`} className={`transcript-block transcript-block-${bloco.papel}`}>
          <div className="transcript-meta">
            <strong>{nome}</strong>
            {onOuvir ? <button type="button" onClick={() => onOuvir(bloco.inicioMs)} aria-label={t`Ouvir trecho aos ${segundos}s`}><Trans>Tempo de fala: {duracao}</Trans></button> : <span><Trans>Tempo de fala: {duracao}</Trans></span>}
          </div>
          <div className="transcript-text">{bloco.linhas.map((linha, indice) => {
            const insight = insightDaLinha(linha.consultaId)
            return <Fragment key={linha.id}>
              {indice > 0 && ' '}
              {insight ? <button type="button" className={soPossiveis(insight.resultado) ? 'transcript-insight transcript-insight-possivel' : 'transcript-insight'}
                ref={(elemento) => { if (elemento) botoes.current.set(insight.consulta.id, elemento); else botoes.current.delete(insight.consulta.id) }}
                data-consulta-id={insight.consulta.id}
                aria-controls={`${prefixo}-${insight.consulta.id}`} aria-expanded={aberta === JSON.stringify(insight.consulta)}
                onClick={() => abrir(insight.consulta.id)}>{linha.texto}</button> : <span className={linha.parcial ? 'transcript-parcial' : undefined}>{linha.texto}</span>}
              {semAnaliseIds.has(linha.consultaId) && <span className="transcript-aviso"><Trans>Esta fala ficou sem análise.</Trans></span>}
            </Fragment>
          })}</div>
        </li>
      })}</ol>
    </section>
    <section aria-label={t`Copiloto`}>
    <p className="editorial-eyebrow"><Trans>Contexto e referências</Trans></p>
    <h3><Trans>Insights durante a sessão</Trans></h3>
    {servico && consultas.length > 0 && <p role="status">{servico === 'fora'
      ? t`Serviço do copiloto fora do ar. Tentando de novo.`
      : t`Copiloto não liberado. A transcrição segue normalmente, sem análise das falas.`}</p>}
    {pergunta && <div role="group" aria-label={t`Enviar seus votos`}>
      <p><Trans>Enviar seus votos, sem identificação, para melhorar as sugestões?</Trans></p>
      <button type="button" className="button-secondary" onClick={() => void responder('sim')}><Trans>Enviar</Trans></button>
      <button type="button" className="button-secondary" onClick={() => void responder('nao')}><Trans>Só neste aparelho</Trans></button>
    </div>}
    {autorizada && semMateriais ? <p role="status">{temObrasAutorizadas
      ? <Trans>Selecione uma obra para receber referências nesta sessão.</Trans>
      : <Link to="/acervo"><Trans>Autorize materiais no acervo para receber referências durante a sessão.</Trans></Link>}</p>
      : qualificados.size === 0 && <p><Trans>Quando houver um insight, a fala será marcada com tracejado.</Trans></p>}
    {[...qualificados.values()].map(({ consulta, resultado }) => {
      const quantidade = resultado.cartoes.length
      const porcentagemJuiz = Math.round(Math.max(0, ...resultado.cartoes.map(fonte => fonte.probabilidade)) * 1000) / 10
      const fortes = resultado.cartoes.filter((fonte) => fonte.nivel === 'forte')
      const possiveis = resultado.cartoes.filter((fonte) => fonte.nivel === 'possivel')
      const cartao = (fonte: FonteInsight) => {
        const pagina = fonte.pagina
        const paragrafo = fonte.paragrafo
        const porcentagemJuiz = Math.round(fonte.probabilidade * 1000) / 10
        return <div key={fonte.trecho_id} className="insight-source">
          <p><strong>{fonte.titulo}</strong>{' — '}{fonte.autor}</p>
          <p><Trans>Página {pagina}, parágrafo {paragrafo}</Trans></p>
          <p><Trans>Pertinência à frase — juiz: {porcentagemJuiz}%</Trans></p>
          {(fonte.fenomeno_na_fala || fonte.fenomeno_no_trecho) && <p>{fonte.fenomeno_na_fala}{' — '}{fonte.fenomeno_no_trecho}</p>}
          <blockquote>{fonte.citacao_literal}</blockquote>
          {votos && <div role="group" aria-label={t`Esta fonte foi útil?`}>
            {/* eslint-disable-next-line lingui/no-unlocalized-strings -- valores do contrato de voto. */}
            {(['util', 'nao_util'] as const).map(voto => <button key={voto} type="button" className="button-secondary"
              aria-pressed={votados[chaveVoto(consulta.frase, fonte.citacao_literal, resultado.juiz)] === voto}
              onClick={() => void votar(consulta, fonte, resultado.juiz, voto)}>{voto === 'util' ? t`Útil` : t`Não útil`}</button>)}
          </div>}
          <button type="button" disabled={!onSelectFonte} onClick={onSelectFonte ? () => {
            const ids = consulta.ancoras ?? [consulta.id]
            const inicio = linhasFinais.find(item => item.consultaId === ids[0])!
            const fim = linhasFinais.find(item => item.consultaId === ids[ids.length - 1])!
            onSelectFonte(consulta, fonte, inicio.inicioMs, fim.fimMs)
          } : undefined}><Trans>Usar na nota</Trans></button>
        </div>
      }
      return <details key={`${consulta.id}:${JSON.stringify(consulta)}`} id={`${prefixo}-${consulta.id}`} className="insight-balloon"
        ref={(elemento) => { if (elemento) baloes.current.set(consulta.id, elemento); else baloes.current.delete(consulta.id) }}
        open={aberta === JSON.stringify(consulta)} onToggle={(evento) => {
          const abertaAgora = evento.currentTarget.open
          const chave = JSON.stringify(consulta)
          setAberta((atual) => abertaAgora ? chave : atual === chave ? null : atual)
        }}>
        <summary tabIndex={0}><Trans>Fontes pertinentes</Trans> ({quantidade}){quantidade > 0 && <>{' — '}
          <Trans>Maior pertinência — juiz: {porcentagemJuiz}%</Trans></>}</summary>
        <p>{consulta.frase}</p>
        {resultado.clarificar && <p><Trans>Esclareça o contexto desta fala com o paciente.</Trans></p>}
        {resultado.alerta_risco && <p><Trans>Avalie esta fala no contexto do atendimento.</Trans></p>}
        {fortes.map(cartao)}
        {possiveis.length > 0 && <details className="insight-possiveis">
          <summary><Trans>Possíveis: confira antes de usar</Trans> ({possiveis.length})</summary>
          {possiveis.map(cartao)}
        </details>}
        {!onSelectFonte && quantidade > 0 && <p><Trans>Salve a revisão da transcrição para usar uma referência na nota.</Trans></p>}
        <button type="button" className="button-secondary insight-return" onClick={() => {
          setAberta(null)
          const botao = botoes.current.get(consulta.id)!
          botao.focus()
          botao.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
        }}><Trans>Voltar à fala</Trans></button>
      </details>
    })}
    </section>
  </div>
}
