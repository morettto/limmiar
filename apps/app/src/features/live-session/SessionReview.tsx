import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { CryptoKey } from '@limmiar/crypto'
import { montarTranscricaoCanonica, type PalavraAtribuida, type RotuloLocutor } from '@limmiar/diarization'
import type { ConsentimentosDoPaciente } from '../../entities/consentimento/api'
import { appendPatientEntry, getPatientRecord } from '../../entities/patient/api'
import { openEntries, sealEntry } from '../../entities/patient/patient-crypto'
import { lerTranscricao, transcricaoParaEntrada, type Transcricao } from '../../entities/transcricao/transcricao'
import { msg } from '@lingui/core/macro'
import { translateProblemCode } from '../../shared/api'
import { traduzir, type Texto } from '../../shared/i18n'
import { abrirMicrofone } from '../../entities/consentimento/microfone'
import { transcreverLocal } from './transcrever-local'
import { papelDoFalante, transcreverAoVivo, type SessaoTranscricao, type TranscricaoAoVivo } from './transcrever-ao-vivo'
import { LiveInsights } from './LiveInsights'
import { abrirPerfilDeVoz } from './perfil-de-voz'
import { PAPEIS_ONLINE, transcreverOnline } from './transcrever-online'
import { setMaterialUsage } from '../../entities/material/api'
import { acquireMaterialCapture, pendingMaterialCaptures, recoverMaterialCaptures, type MaterialCapture } from '../../entities/material/material-capture'
import { prepareAuthorizedMaterials, type SessionMaterial } from '../../entities/material/authorized-materials'
import type { PropostaReferencia } from '../../entities/nota/referencia'

const FECHAR_PAGINA = 'beforeunload'
// eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option values are not visible copy.
const FORMATO_REVISAO: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'medium' }

interface PacienteDaSessao {
  id: string
  nome: string
  dek: CryptoKey
  consentimentos: ConsentimentosDoPaciente
  transcricoes: Transcricao[]
}

export interface SessionReviewProps {
  baseUrl: string
  accessToken: string
  accountId: string
  kek: CryptoKey
  paciente: PacienteDaSessao
  onPendingChange(pendente: boolean): void
  /** A sessão: a transcrição única desta sessão usa este id; correções são revisões dela. */
  atendimentoId: string
  /** Última revisão já salva desta sessão; abre com ela, sem gravação nova. */
  transcricao?: Transcricao
  online?: { local: MediaStream | null; remoto: MediaStream | null; ativa: boolean }
  prepararEncerramento?(encerrar: () => Promise<void>): void
  encerrada?: boolean
  bloqueada?: boolean
  onPreparingChange?(preparando: boolean): void
  onSaved?(transcricao: Transcricao): void
  onPropostaReferencia?(proposta: PropostaReferencia): void
}

export function SessionReview({ baseUrl, accessToken, accountId, kek, paciente, atendimentoId, transcricao, onPendingChange, online, prepararEncerramento, onSaved, onPropostaReferencia, encerrada = false, bloqueada = false, onPreparingChange }: SessionReviewProps) {
  const { i18n, t } = useLingui()
  const [palavras, setPalavras] = useState<PalavraAtribuida[]>(() => transcricao?.palavras ?? [])
  const [palavrasFinais, setPalavrasFinais] = useState<PalavraAtribuida[]>(() => transcricao?.palavras ?? [])
  const [palavrasHipotese, setPalavrasHipotese] = useState<PalavraAtribuida[]>([])
  const [papeis, setPapeis] = useState<Record<string, RotuloLocutor | null>>(() => transcricao?.papeis ?? {})
  // Stryker disable next-line ConditionalExpression: equivalent, every flow that shows words resets the flag first.
  const [revisada, setRevisada] = useState(transcricao !== undefined)
  const [ocupado, setOcupado] = useState(false)
  const [gravando, setGravando] = useState(false)
  // Stryker disable next-line BooleanLiteral: equivalent, `iniciarGravacao` resets it and it only shows while recording.
  const [pausada, setPausada] = useState(false)
  // Stryker disable next-line ConditionalExpression: equivalent, with no words the stable mark is not read.
  const [estavelAteMs, setEstavelAteMs] = useState(transcricao === undefined ? 0 : Number.MAX_SAFE_INTEGER)
  const [finais, setFinais] = useState<number>()
  const [mensagem, setMensagem] = useState<Texto | null>(() => transcricao === undefined ? null : msg`Transcrição recuperada do prontuário. O áudio não é armazenado.`)
  const [erroCaptura, setErroCaptura] = useState<Texto | null>(null)
  const [aviso, setAviso] = useState<TranscricaoAoVivo['aviso']>()
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [historico, setHistorico] = useState(() => paciente.transcricoes.filter((item) => item.id === atendimentoId))
  const [revisao, setRevisao] = useState(transcricao?.revisao ?? -1)
  const [alterada, setAlterada] = useState(false)
  const votosLocais = useMemo(() => ({ accountId, kek }), [accountId, kek])
  const acessoAtual = useRef({ baseUrl, accountId, accessToken })
  acessoAtual.current = { baseUrl, accountId, accessToken }
  const [materiaisAutorizados, setMateriaisAutorizados] = useState<string[] | null>(null)
  const [materiaisPendentes, setMateriaisPendentes] = useState(0)
  const [materiais, setMateriais] = useState<SessionMaterial[]>([])
  const [selecionados, setSelecionados] = useState<string[]>(transcricao?.materialIds ?? [])
  const materialSelection = useRef({ selecionados, materiais })
  materialSelection.current = { selecionados, materiais }
  const tentativa = useRef<Transcricao | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const sessaoAoVivo = useRef<SessaoTranscricao | null>(null)
  const sessaoOnline = useRef<SessaoTranscricao | null>(null)
  const filaOnline = useRef(Promise.resolve())
  const fimPresencial = useRef(Promise.resolve())
  const inicioPresencial = useRef<Promise<SessaoTranscricao> | null>(null)
  const capturasEncerradas = useRef(new Map<string, MaterialCapture>())
  const [liberacaoPendente, setLiberacaoPendente] = useState(false)
  const [retomadaPendente, setRetomadaPendente] = useState(() => pendingMaterialCaptures(accountId, atendimentoId).length > 0)
  const palavrasOnline = useRef<PalavraAtribuida[]>([])
  const finaisPresenciaisFonte = useRef<PalavraAtribuida[] | undefined>(undefined)
  const inicioOnline = useRef<number | null>(null)
  const controller = useRef<AbortController | null>(null)
  const corrigidos = useRef<Record<string, RotuloLocutor | null>>({})
  const player = useRef<HTMLAudioElement | null>(null)
  const perfilPronto = useRef<Promise<{ perfil: number[] | null; falhou: boolean }> | null>(null)
  // Stryker disable next-line BooleanLiteral: equivalent, the effect below sets the flag before any async work.
  const montado = useRef(true)
  const consentimentos = useRef(paciente.consentimentos)
  consentimentos.current = paciente.consentimentos
  const autorizada = paciente.consentimentos.gravacao === 'concedido'
  const analiseAutorizada = paciente.consentimentos.analiseIa === 'concedido'
  const temTranscricao = transcricao !== undefined
  const locutores = Object.keys(papeis)
  const papelDe = new Map<string | null, RotuloLocutor | null>(Object.entries(papeis))
  const identificada = palavras.every((palavra) => palavra.texto.trim() !== '' && papelDe.get(palavra.locutor) != null)
  const haPendencias = gravando || ocupado || alterada
  const jaGravada = revisao >= 0
  const bibliografiaSelecionada = useMemo(() => materiaisAutorizados === null ? undefined : {
    accountId, accessToken, materialIds: selecionados.filter(id => materiaisAutorizados.includes(id)),
  }, [materiaisAutorizados, selecionados, accountId, accessToken])

  useEffect(() => {
    if (online || !autorizada || !analiseAutorizada || jaGravada || encerrada) return
    const abort = new AbortController()
    let perfil: number[] | null = null
    perfilPronto.current = abrirPerfilDeVoz(baseUrl, accountId, accessToken, kek, abort.signal)
      .then(aberto => { perfil = aberto; return { perfil: aberto, falhou: false } }, () => ({ perfil: null, falhou: true }))
    return () => { abort.abort(); perfil?.fill(0); perfilPronto.current = null }
  }, [baseUrl, accountId, accessToken, kek, online, autorizada, analiseAutorizada, jaGravada, encerrada])

  useEffect(() => {
    let ativa = true
    let espera: ReturnType<typeof setTimeout> | undefined
    setMateriaisAutorizados(null); setMateriaisPendentes(0)
    function carregar(primeira: boolean) {
      const acesso = acessoAtual.current
      void prepareAuthorizedMaterials(acesso, kek).then(result => {
        if (ativa) {
          setMateriaisAutorizados(result.materialIds); setMateriaisPendentes(result.pending)
          setMateriais(result.materials.filter(item => item.ready))
          if (temTranscricao) setSelecionados(ids => ids.filter(id => result.materialIds.includes(id)))
          if (primeira && !temTranscricao) setSelecionados(result.materialIds)
          if (result.pending > 0) espera = setTimeout(() => carregar(false), 1500)
        }
      }).catch(() => { if (ativa) setMateriaisPendentes(1) })
    }
    if (analiseAutorizada) carregar(true)
    return () => { ativa = false; clearTimeout(espera) }
  }, [baseUrl, accountId, kek, analiseAutorizada, temTranscricao])

  useEffect(() => { onPendingChange(haPendencias) }, [haPendencias, onPendingChange])
  useEffect(() => { onPreparingChange?.(ocupado) }, [ocupado, onPreparingChange])
  useEffect(() => {
    if (!haPendencias) return
    const avisar = (evento: BeforeUnloadEvent) => { evento.preventDefault(); evento.returnValue = '' }
    window.addEventListener(FECHAR_PAGINA, avisar)
    return () => window.removeEventListener(FECHAR_PAGINA, avisar)
  }, [haPendencias])

  // Stryker disable ArrayDeclaration: equivalent, any constant dependency list runs the effect once.
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
      controller.current?.abort()
      if (recorder.current?.state !== 'inactive') recorder.current?.stop()
      recorder.current?.stream.getTracks().forEach((track) => track.stop())
    }
  }, [])
  // Stryker restore ArrayDeclaration
  useEffect(() => {
    if (!autorizada || !analiseAutorizada) controller.current?.abort()
    if ((!autorizada || !analiseAutorizada) && recorder.current?.state !== 'inactive') recorder.current?.stop()
    if (!analiseAutorizada) {
      palavrasOnline.current = []; inicioOnline.current = null
      finaisPresenciaisFonte.current = undefined
      setPalavras([]); setPalavrasFinais([]); setPalavrasHipotese([]); setPapeis({}); setAlterada(false)
    }
  }, [autorizada, analiseAutorizada])
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }, [audioUrl])

  useEffect(() => {
    prepararEncerramento?.(async () => {
      const gravador = recorder.current
      if (gravador && gravador.state !== 'inactive') {
        await new Promise<void>(resolve => {
          gravador.addEventListener('stop', () => resolve(), { once: true })
          gravador.stop()
        })
        await fimPresencial.current
      }
      await filaOnline.current
      await sessaoOnline.current?.encerrar()
      setGravando(false); setEstavelAteMs(Number.MAX_SAFE_INTEGER)
    })
  }, [prepararEncerramento])

  const liberarCaptura = useCallback(async (captura: MaterialCapture | undefined) => {
    if (!captura) return
    capturasEncerradas.current.set(captura.captureId, captura)
    try {
      await captura.release(acessoAtual.current)
      capturasEncerradas.current.delete(captura.captureId)
      setLiberacaoPendente(capturasEncerradas.current.size > 0)
    } catch (erro) {
      setLiberacaoPendente(true)
      setErroCaptura(erro instanceof Error ? erro.message : msg`Não foi possível concluir. Tente novamente.`)
    }
  }, [])

  const adquirirCaptura = useCallback(async () => {
    const ids = materialSelection.current.selecionados
    if (ids.some(id => !materialSelection.current.materiais.some(item => item.materialId === id && item.ready))) throw new Error(i18n._(msg`Aguarde o preparo dos materiais selecionados.`))
    try { return await acquireMaterialCapture(acessoAtual.current, atendimentoId, ids) }
    catch (erro) { setRetomadaPendente(true); throw erro }
  }, [atendimentoId, i18n])

  const reservarMateriais = useCallback(async (ids = materialSelection.current.selecionados) => {
    if (ids.some(id => !materialSelection.current.materiais.some(item => item.materialId === id && item.ready))) throw new Error(i18n._(msg`Aguarde o preparo dos materiais selecionados.`))
    if (ids.length === 0) return
    const result = await setMaterialUsage(acessoAtual.current, atendimentoId, ids)
    if (!result.ok) throw new Error(translateProblemCode(result.code, result.params, i18n))
  }, [atendimentoId, i18n])

  async function selecionarMateriais(ids: string[]) {
    setOcupado(true)
    try {
      if (palavras.length > 0) await reservarMateriais(ids)
      if (!montado.current) return
      setSelecionados(ids)
      setAlterada(palavras.length > 0)
      tentativa.current = null
    } catch (erro) { setMensagem(erro instanceof Error ? erro.message : msg`Não foi possível concluir. Tente novamente.`) }
    finally { setOcupado(false) }
  }

  const bibliografiaPronta = materiaisAutorizados !== null
  const localOnline = online?.local
  const remotoOnline = online?.remoto
  const onlineAtiva = online?.ativa
  useEffect(() => {
    if (!bibliografiaPronta || !localOnline || !remotoOnline || !onlineAtiva || !autorizada || !analiseAutorizada || jaGravada) return
    let cancelada = false
    let sessao: SessaoTranscricao | null = null
    let captura: MaterialCapture | undefined
    const abort = new AbortController()
    filaOnline.current = filaOnline.current.then(async () => {
      if (cancelada) return
      controller.current = abort
      inicioOnline.current ??= performance.now()
      const anteriores = palavrasOnline.current
      let fonteFinalAnterior: PalavraAtribuida[] | undefined
      let finaisCombinados = anteriores
      const inicioMs = Math.round(performance.now() - inicioOnline.current)
      setOcupado(true); setErroCaptura(null); setAviso(undefined); setRevisada(false)
      try {
        captura = await adquirirCaptura()
        if (cancelada || abort.signal.aborted) { await liberarCaptura(captura); captura = undefined; return }
        sessao = await transcreverOnline(localOnline, remotoOnline, abort.signal, transcricao => {
          if (abort.signal.aborted) return
          const novas = [...anteriores, ...transcricao.palavras].sort((a, b) => a.inicioMs - b.inicioMs || a.fimMs - b.fimMs)
          palavrasOnline.current = novas
          const fonteFinal = transcricao.palavrasFinais ?? transcricao.palavras.slice(0, transcricao.finais)
          if (fonteFinal !== fonteFinalAnterior) {
            fonteFinalAnterior = fonteFinal
            finaisCombinados = [...anteriores, ...fonteFinal].sort((a, b) => a.inicioMs - b.inicioMs || a.fimMs - b.fimMs)
            setPalavrasFinais(finaisCombinados)
          }
          const hipotese = transcricao.palavrasHipotese ?? transcricao.palavras.slice(transcricao.finais)
          setPalavras(novas); setPalavrasHipotese(hipotese)
          setPapeis(PAPEIS_ONLINE); setAlterada(novas.length > 0)
          setEstavelAteMs(transcricao.estavelAteMs); setFinais(transcricao.finais); setAviso(transcricao.aviso); setRevisada(false); tentativa.current = null
        }, erro => { if (!abort.signal.aborted) setErroCaptura(erro.message) }, inicioMs)
        const aberta = sessao
        sessaoOnline.current = { ...aberta, async encerrar() {
          try { await aberta.encerrar() }
          finally { abort.abort(); await liberarCaptura(captura) }
        } }
        if (!cancelada) {
          setGravando(true)
          setMensagem(msg`Transcrição online ao vivo. Cada trilha identifica quem está falando.`)
        }
      } catch {
        if (!sessao) { abort.abort(); await liberarCaptura(captura); captura = undefined }
        if (!cancelada) setErroCaptura(msg`Não foi possível transcrever a chamada. O áudio não foi salvo.`)
      } finally { setOcupado(false) }
    })
    return () => {
      cancelada = true
      if (!sessao) abort.abort()
      filaOnline.current = filaOnline.current.then(async () => {
        try { await sessao?.encerrar() }
        catch { setErroCaptura(msg`A transcrição foi interrompida. Revise o texto recuperado.`) }
        finally {
          abort.abort()
          await liberarCaptura(captura); captura = undefined
          sessaoOnline.current = null
          setGravando(false); setEstavelAteMs(Number.MAX_SAFE_INTEGER)
        }
      })
    }
  }, [localOnline, remotoOnline, onlineAtiva, autorizada, analiseAutorizada, jaGravada, bibliografiaPronta, adquirirCaptura, liberarCaptura])

  async function analisar(audio: Blob) {
    if (consentimentos.current.gravacao !== 'concedido') return
    setAudioUrl(URL.createObjectURL(audio))
    if (consentimentos.current.analiseIa !== 'concedido') {
      setMensagem(msg`O áudio é temporário nesta sessão. Autorize a análise por IA para transcrever.`)
      return
    }
    const abort = new AbortController()
    controller.current?.abort()
    controller.current = abort
    setOcupado(true)
    setMensagem(msg`Preparando o áudio para o Nemotron...`)
    setPalavras([])
    setPalavrasFinais([])
    setPalavrasHipotese([])
    setPapeis({})
    setRevisada(false)
    setAlterada(false)
    setEstavelAteMs(0)
    tentativa.current = null
    let captura: MaterialCapture | undefined
    try {
      captura = await adquirirCaptura()
      abort.signal.throwIfAborted()
      const acesso = acessoAtual.current
      const perfil = await abrirPerfilDeVoz(acesso.baseUrl, acesso.accountId, acesso.accessToken, kek, abort.signal)
      if (perfil === null) { setMensagem(msg`Cadastre sua voz antes de transcrever: é preciso saber quem está falando.`); return }
      const resultado = await transcreverLocal(audio, abort.signal, perfil)
      if (!abort.signal.aborted) {
        setPalavras(resultado)
        setPalavrasFinais(resultado)
        setPalavrasHipotese([])
        setPapeis(Object.fromEntries(resultado.flatMap((palavra) => palavra.locutor === null ? [] : [[palavra.locutor, papelDoFalante(palavra.locutor)]])))
        setAlterada(resultado.length > 0)
        setEstavelAteMs(Number.MAX_SAFE_INTEGER)
        setMensagem(resultado.length === 0 ? msg`Nenhuma fala foi reconhecida.` : msg`Transcrição concluída. Confirme os papéis das vozes.`)
      }
    } catch (erro) {
      if (!abort.signal.aborted) setMensagem(erro instanceof Error ? erro.message : msg`Não foi possível processar o áudio.`)
    } finally {
      await liberarCaptura(captura)
      if (controller.current === abort) setOcupado(false)
    }
  }

  async function iniciarGravacao() {
    if (analiseAutorizada && materiaisAutorizados === null) return
    setOcupado(true)
    setErroCaptura(null)
    setAviso(undefined)
    let captura: MaterialCapture | undefined
    let capturaTransferida = false
    const resultado = await abrirMicrofone(paciente.consentimentos.gravacao)
    if (!resultado.ok) { setOcupado(false); setMensagem(msg`Autorize a gravação e permita o microfone.`); return }
    try {
      if (!montado.current || consentimentos.current.gravacao !== 'concedido') {
        resultado.microfone.stream.getTracks().forEach((track) => track.stop())
        return
      }
      const gravador = new MediaRecorder(resultado.microfone.stream)
      const abort = new AbortController()
      controller.current?.abort()
      controller.current = abort
      corrigidos.current = {}
      finaisPresenciaisFonte.current = undefined
      tentativa.current = null
      setPalavras([])
      setPalavrasFinais([])
      setPalavrasHipotese([])
      setPapeis({})
      setEstavelAteMs(0)
      setPausada(false)
      sessaoAoVivo.current = null
      inicioPresencial.current = null
      const partes: Blob[] = []
      let tamanho = 0
      gravador.addEventListener('dataavailable', (evento) => {
        tamanho += evento.data.size
        if (tamanho > 64 * 1024 * 1024) {
          setErroCaptura(msg`A captura atingiu 64 MB e foi encerrada.`)
          if (gravador.state !== 'inactive') gravador.stop()
          return
        }
        partes.push(evento.data)
      })
      gravador.addEventListener('stop', () => {
        setGravando(false)
        const audio = new Blob(partes, { type: gravador.mimeType })
        partes.length = 0
        recorder.current = null
        const iniciada = inicioPresencial.current
        sessaoAoVivo.current = null
        fimPresencial.current = (async () => {
          setOcupado(true)
          try {
            const sessao = await iniciada
            if (sessao) {
              await sessao.encerrar()
              if (!abort.signal.aborted) {
                setAudioUrl(URL.createObjectURL(audio))
                setEstavelAteMs(Number.MAX_SAFE_INTEGER)
                setMensagem(msg`Transcrição concluída. Confirme os papéis das vozes.`)
              }
            } else if (!abort.signal.aborted) await analisar(audio)
          } finally {
            abort.abort()
            resultado.microfone.stream.getTracks().forEach(track => track.stop())
            await liberarCaptura(captura)
            setOcupado(false)
          }
        })()
        void fimPresencial.current.catch(() => setErroCaptura(msg`A transcrição foi interrompida. Revise o texto recuperado.`))
      }, { once: true })
      captura = await adquirirCaptura()
      abort.signal.throwIfAborted()
      if (consentimentos.current.analiseIa === 'concedido') {
        const preparado = await perfilPronto.current!
        const perfil = preparado.perfil?.slice() ?? null
        const falhaNoPerfil = preparado.falhou
        if (abort.signal.aborted || perfil === null) {
          if (!abort.signal.aborted) {
            setErroCaptura(falhaNoPerfil ? msg`Seu perfil de voz não pôde ser aberto. Sem ele não dá para saber quem está falando.` : msg`Cadastre sua voz antes de gravar: é preciso saber quem está falando.`)
          }
          resultado.microfone.stream.getTracks().forEach((track) => track.stop())
          return
        }
        recorder.current = gravador
        gravador.start(5000)
        capturaTransferida = true
        inicioPresencial.current = transcreverAoVivo(resultado.microfone.stream, abort.signal, (transcricao) => {
          if (abort.signal.aborted) return
          setPalavras(transcricao.palavras)
          const fonteFinal = transcricao.palavrasFinais ?? transcricao.palavras.slice(0, transcricao.finais)
          if (fonteFinal !== finaisPresenciaisFonte.current) {
            finaisPresenciaisFonte.current = fonteFinal
            setPalavrasFinais(fonteFinal)
            setPapeis(Object.fromEntries(fonteFinal.flatMap((palavra) => palavra.locutor === null ? [] : [[palavra.locutor,
              palavra.locutor in corrigidos.current ? corrigidos.current[palavra.locutor] : papelDoFalante(palavra.locutor)]])))
          }
          const hipotese = transcricao.palavrasHipotese ?? transcricao.palavras.slice(transcricao.finais)
          setPalavrasHipotese(hipotese)
          const papeisHipotese = Object.fromEntries(hipotese.flatMap((palavra) => palavra.locutor === null ? [] : [[palavra.locutor,
            palavra.locutor in corrigidos.current ? corrigidos.current[palavra.locutor] : papelDoFalante(palavra.locutor)]]))
          setPapeis((atuais) => {
            const novos = Object.entries(papeisHipotese).filter(([locutor, papel]) => atuais[locutor] !== papel)
            return novos.length === 0 ? atuais : { ...atuais, ...Object.fromEntries(novos) }
          })
          setEstavelAteMs(transcricao.estavelAteMs)
          setFinais(transcricao.finais)
          setAviso(transcricao.aviso)
          setRevisada(false)
          setAlterada(transcricao.palavras.length > 0)
        }, (erro) => {
          if (abort.signal.aborted) return
          setErroCaptura(erro.message)
          if (gravador.state !== 'inactive') gravador.stop()
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Transport option value, not visible copy.
        }, { trilhas: 'proprias', perfil })
        sessaoAoVivo.current = await inicioPresencial.current
      }
      if (abort.signal.aborted) return
      recorder.current = gravador
      if (gravador.state === 'inactive') gravador.start(5000)
      capturaTransferida = true
      setGravando(true)
      setMensagem(msg`Transcrição ao vivo. Seu perfil de voz identifica quem está falando.`)
    } catch {
      controller.current?.abort()
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
      resultado.microfone.stream.getTracks().forEach((track) => track.stop())
      await liberarCaptura(captura)
      setMensagem(msg`Não foi possível iniciar a gravação.`)
    } finally {
      if (!capturaTransferida) await liberarCaptura(captura)
      setOcupado(false)
    }
  }

  function tocar(inicioMs: number) {
    player.current!.currentTime = inicioMs / 1000
    void player.current!.play().catch(() => setMensagem(msg`Não foi possível reproduzir o áudio.`))
  }

  function corrigir(indice: number, alteracao: Partial<PalavraAtribuida>) {
    const corrigidasAgora = palavras.map((palavra, i) => i === indice ? { ...palavra, ...alteracao } : palavra)
    setPalavras(corrigidasAgora)
    setPalavrasFinais(corrigidasAgora)
    setPalavrasHipotese([])
    setRevisada(false)
    setAlterada(true)
    tentativa.current = null
  }

  function abrir(transcricao: Transcricao) {
    setAudioUrl(null)
    setRevisao(transcricao.revisao)
    setPalavras(transcricao.palavras)
    setPalavrasFinais(transcricao.palavras)
    setPalavrasHipotese([])
    setEstavelAteMs(Number.MAX_SAFE_INTEGER)
    setPapeis(transcricao.papeis)
    setSelecionados(transcricao.materialIds ?? [])
    setRevisada(true)
    setAlterada(false)
    tentativa.current = null
    setMensagem(msg`Transcrição recuperada do prontuário. O áudio não é armazenado.`)
  }

  async function salvar() {
    setOcupado(true)
    setMensagem(null)
    try {
      const acesso = acessoAtual.current
      const registro = await getPatientRecord(acesso.baseUrl, acesso.accountId, acesso.accessToken, paciente.id)
      if (!registro.ok) throw new Error(translateProblemCode(registro.code, registro.params, i18n))
      const bytes = await openEntries(paciente.dek, registro.entries, paciente.id)
      const transcricoes = bytes.flatMap((entrada) => {
        const lida = lerTranscricao(entrada, paciente.id)
        return lida === null || lida.id !== atendimentoId ? [] : [lida]
      })
      if (!montado.current) return
      setHistorico(transcricoes)
      const ultima = transcricoes.at(-1)
      const nova = tentativa.current ?? {
        id: atendimentoId, patientId: paciente.id, revisao: revisao + 1, autorId: accountId, registradaEm: new Date().toISOString(),
        palavras, papeis: Object.fromEntries(Object.entries(papeis).filter((entrada): entrada is [string, RotuloLocutor] => entrada[1] !== null)),
        materialIds: selecionados,
      }
      tentativa.current = nova
      const jaSalva = ultima !== undefined && new TextDecoder().decode(transcricaoParaEntrada(ultima)) === new TextDecoder().decode(transcricaoParaEntrada(nova))
      if (!jaSalva) {
        if ((ultima?.revisao ?? -1) !== revisao) { setMensagem(msg`Outra revisão foi salva. Reabra a transcrição antes de corrigir.`); return }
        const sequence = registro.entries.length + 1
        const ciphertext = await sealEntry(paciente.dek, paciente.id, sequence, transcricaoParaEntrada(nova))
        const acessoAtualizado = acessoAtual.current
        const resultado = await appendPatientEntry(acessoAtualizado.baseUrl, acessoAtualizado.accountId, acessoAtualizado.accessToken, paciente.id, { sequence, ciphertext })
        if (!resultado.ok) throw new Error(translateProblemCode(resultado.code, resultado.params, i18n))
      }
      if (montado.current) {
        setHistorico(jaSalva ? transcricoes : [...transcricoes, nova])
        setRevisao(nova.revisao)
        setAlterada(false)
        onSaved?.(nova)
        tentativa.current = null
        setMensagem(msg`Transcrição salva no prontuário. Somente texto, tempos e identificação das falas foram armazenados.`)
      }
    } catch (erro) {
      setMensagem(erro instanceof Error ? erro.message : msg`Não foi possível salvar a transcrição.`)
    } finally { setOcupado(false) }
  }

  function descartar() {
    const anterior = historico.at(-1)
    if (anterior) abrir(anterior)
    else { setPalavras([]); setPalavrasFinais([]); setPalavrasHipotese([]); setPapeis({}); setAudioUrl(null); setAlterada(false); tentativa.current = null }
  }

  return <section className="workspace-card" aria-label={t`Gravação e transcrição`}>
    <h2><Trans>Gravação e transcrição</Trans></h2>
    <p>{online ? <Trans>Na sessão online, as trilhas identificam profissional e paciente. Confira o texto antes de salvar.</Trans>
      : <Trans>Seu perfil de voz identifica o profissional. Confira as falas incertas antes de usar a transcrição.</Trans>}</p>
    {!autorizada && <p role="status"><Trans>O consentimento de gravação é necessário.</Trans></p>}
    {retomadaPendente && <button type="button" className="button-secondary" onClick={() => {
      void recoverMaterialCaptures(acessoAtual.current, atendimentoId).then(ativas => {
        setRetomadaPendente(ativas > 0)
        if (ativas > 0) setErroCaptura(msg`Encerre a captura na aba de origem. Se ela já foi interrompida, recarregue essa aba e tente novamente.`)
      }).catch(erro => setErroCaptura(erro instanceof Error ? erro.message : msg`Não foi possível concluir. Tente novamente.`))
    }}><Trans>Recuperar capturas interrompidas</Trans></button>}
    {liberacaoPendente && <button type="button" className="button-secondary" onClick={() => { void Promise.all([...capturasEncerradas.current.values()].map(liberarCaptura)) }}><Trans>Tentar liberar captura encerrada</Trans></button>}
    {!online && <div className="my-3 flex flex-wrap gap-3">
      <button type="button" className="button-primary" disabled={bloqueada || ocupado || (!gravando && (!autorizada || alterada || jaGravada || encerrada || (analiseAutorizada && !bibliografiaPronta)))} onClick={() => gravando ? recorder.current!.stop() : void iniciarGravacao()}>
        {gravando ? <Trans>Encerrar gravação</Trans> : <Trans>Iniciar gravação</Trans>}
      </button>
      {gravando && sessaoAoVivo.current && <button type="button" onClick={() => {
        sessaoAoVivo.current!.pausar(!pausada)
        setPausada(!pausada)
      }}>{pausada ? <Trans>Retomar sessão</Trans> : <Trans>Pausar sessão</Trans>}</button>}
      <label><Trans>Ou carregar áudio</Trans><input type="file" accept="audio/*" disabled={!autorizada || ocupado || gravando || alterada || jaGravada || encerrada || bloqueada || (analiseAutorizada && !bibliografiaPronta)}
        onChange={(e) => {
          if (analiseAutorizada && !bibliografiaPronta) return
          const arquivo = e.target.files![0]
          if (!arquivo) return
          if (arquivo.size === 0 || !arquivo.type.startsWith('audio/')) { setMensagem(msg`Escolha um arquivo de áudio válido.`); return }
          if (arquivo.size > 64 * 1024 * 1024) { setMensagem(msg`O áudio deve ter até 64 MB.`); return }
          setErroCaptura(null)
          void analisar(arquivo)
          e.target.value = ''
        }} /></label>
    </div>}
    {ocupado && <p role="status"><Trans>Transcrevendo e separando as vozes...</Trans></p>}
    {mensagem !== null && <p role="status">{traduzir(i18n, mensagem)}</p>}
    {erroCaptura !== null && <p role="alert">{traduzir(i18n, erroCaptura)}</p>}
    {gravando && aviso === 'reconectando' && <p role="status"><Trans>A conexão com a transcrição caiu. Reconectando: o que for dito agora será transcrito assim que ela voltar.</Trans></p>}
    {gravando && aviso === 'atrasada' && <p role="status"><Trans>A transcrição está atrasada em relação à fala. O áudio continua sendo enviado.</Trans></p>}
    {analiseAutorizada && materiaisAutorizados === null && materiaisPendentes === 0 && <p role="status"><Trans>Preparando seu acervo autorizado para o copiloto local...</Trans></p>}
    {materiaisPendentes > 0 && <p role="status"><Trans>Há materiais autorizados que não estão prontos nesta máquina. Verifique seu acervo pessoal.</Trans></p>}
    {analiseAutorizada && materiais.length > 0 && <fieldset disabled={ocupado || gravando || bloqueada || encerrada}>
      <legend><Trans>Obras desta sessão</Trans></legend>
      <p><Trans>Escolha as referências que o copiloto poderá consultar neste atendimento.</Trans></p>
      {materiais.map(material => <label key={material.materialId}><input type="checkbox" disabled={!material.ready}
        checked={selecionados.includes(material.materialId)} onChange={evento => {
          void selecionarMateriais(evento.target.checked ? [...selecionados, material.materialId] : selecionados.filter(id => id !== material.materialId))
        }} />{material.title}{!material.ready && <span><Trans> · Em preparação</Trans></span>}</label>)}
    </fieldset>}
    {gravando && <p role="status">{pausada ? <Trans>Microfone pausado.</Trans> : <Trans>O áudio permanece somente em memória durante a sessão.</Trans>}</p>}
    {audioUrl && <audio ref={player} controls src={audioUrl} className="my-3 w-full" />}
    {locutores.length > 0 && !online && <fieldset><legend><Trans>Identificar vozes</Trans></legend>
      {locutores.map((locutor, indice) => {
        const numero = indice + 1
        // Stryker disable next-line StringLiteral: equivalent, an unmatched select value shows the empty first option.
        const atual = papeis[locutor] ?? ''
        return <div key={locutor}><label>
        <Trans>Voz {numero}</Trans>
        <select disabled={ocupado} value={atual} onChange={(e) => {
          const papel = e.target.value === '' ? null : e.target.value as RotuloLocutor
          setPapeis((atual) => {
            const manuais = { ...corrigidos.current }
            Object.entries(atual).forEach(([id, valor]) => { if (valor === papel) manuais[id] = null })
            manuais[locutor] = papel
            corrigidos.current = manuais
            return { ...atual, ...manuais }
          })
          setRevisada(false)
          setAlterada(true)
          tentativa.current = null
        }}>
          <option value=""><Trans>Não identificado</Trans></option><option value="voce"><Trans>Profissional</Trans></option><option value="paciente"><Trans>Paciente</Trans></option>
        </select></label>
        {audioUrl && <button type="button" disabled={!palavras.some((palavra) => palavra.locutor === locutor)} onClick={() => tocar(palavras.find((palavra) => palavra.locutor === locutor)!.inicioMs)}><Trans>Ouvir esta voz</Trans></button>}
      </div>})}
    </fieldset>}
    <LiveInsights palavras={palavras} palavrasFinais={palavrasFinais} palavrasHipotese={palavrasHipotese} papeis={papeis} estavelAteMs={estavelAteMs} finais={gravando ? finais : undefined} autorizada={analiseAutorizada && materiaisAutorizados !== null} bibliografia={bibliografiaSelecionada} temObrasAutorizadas={materiais.length > 0} votos={votosLocais} trilhasSeparadas={online !== undefined} onOuvir={audioUrl ? tocar : undefined}
      onSelectFonte={onPropostaReferencia && jaGravada && !haPendencias && !online?.ativa ? (consulta, fonte, inicioMs, fimMs) => onPropostaReferencia({
        patientId: paciente.id, inicioMs, fimMs, referencia: { trechoId: fonte.trecho_id, titulo: fonte.titulo, autor: fonte.autor,
          pagina: fonte.pagina, paragrafo: fonte.paragrafo, citacaoLiteral: fonte.citacao_literal,
          transcriptId: atendimentoId, revisaoTranscricao: revisao, frasePaciente: consulta.frase },
      }) : undefined} />
    {palavras.length > 0 && <>
      <details className="my-3"><summary><Trans>Corrigir texto e voz por palavra</Trans></summary>
        {audioUrl && <p><Trans>Escute o áudio para corrigir palavras e trechos atribuídos à voz errada.</Trans></p>}
        <ol>{palavras.map((palavra, indice) => {
          const segundos = (palavra.inicioMs / 1000).toFixed(1)
          // Stryker disable next-line StringLiteral: equivalent, an unmatched select value shows the empty first option.
          const vozAtual = palavra.locutor ?? ''
          return <li key={indice} className="my-2 flex flex-wrap gap-2">
          {audioUrl ? <button type="button" aria-label={t`Ouvir palavra aos ${segundos}s`} onClick={() => tocar(palavra.inicioMs)}><Trans>{segundos}s</Trans></button> : <span><Trans>{segundos}s</Trans></span>}
          <label><Trans>Texto aos {segundos}s</Trans>
            <input disabled={ocupado || gravando || bloqueada} value={palavra.texto} onChange={(e) => corrigir(indice, { texto: e.target.value })} />
          </label>
          <label><Trans>Voz aos {segundos}s</Trans>
            <select disabled={ocupado || gravando || bloqueada} value={vozAtual} onChange={(e) => corrigir(indice, { locutor: e.target.value || null })}>
              <option value=""><Trans>Não identificado</Trans></option>
              {locutores.map((locutor, i) => {
                const numero = i + 1
                return <option key={locutor} value={locutor}><Trans>Voz {numero}</Trans></option>
              })}
            </select>
          </label>
        </li>})}</ol>
      </details>
      <label><input type="checkbox" checked={revisada} disabled={!identificada || ocupado || gravando || bloqueada} onChange={(e) => setRevisada(e.target.checked)} />
        {audioUrl ? <Trans>Conferi o texto e quem falou cada trecho ouvindo o áudio.</Trans> : <Trans>Conferi o texto e quem falou cada trecho.</Trans>}
      </label>
      {revisada && <p role="status"><Trans>Transcrição revisada.</Trans></p>}
      <div className="my-3 flex gap-3">
        <button type="button" className="button-primary" disabled={!revisada || !identificada || !alterada || ocupado || gravando || bloqueada} onClick={() => void salvar()}><Trans>Salvar transcrição</Trans></button>
        {alterada && <button type="button" disabled={ocupado || gravando || bloqueada} onClick={descartar}><Trans>Descartar alterações</Trans></button>}
      </div>
    </>}
    {historico.length > 0 && <details className="mt-4"><summary><Trans>Revisões e correções</Trans> ({historico.length})</summary>
      {historico.map((anterior) => {
        const numeroRevisao = anterior.revisao + 1
        const autor = anterior.autorId
        return <article key={anterior.revisao} className="mt-3">
          <p><Trans>Revisão {numeroRevisao}</Trans>{' — '}{i18n.date(anterior.registradaEm, FORMATO_REVISAO)}{' — '}<Trans>Profissional responsável: {autor}</Trans></p>
          {montarTranscricaoCanonica(anterior.palavras, new Map(Object.entries(anterior.papeis))).map((trecho, i) => <p key={i}>
            <strong>{trecho.locutor === 'voce' ? t`Profissional` : t`Paciente`}: </strong>{trecho.palavras.map((palavra) => palavra.texto).join(' ')}
          </p>)}
        </article>
      })}
    </details>}
  </section>
}
