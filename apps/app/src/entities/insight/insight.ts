import { COPILOTO_BASE_URL } from '../../shared/api/copiloto'
import { FalhaServicoInsight } from './falha-insight'
import type { EventoVoto } from './voto-store'

export type NivelInsight = 'forte' | 'possivel'

export interface FonteInsight {
  trecho_id: string
  titulo: string
  autor: string
  pagina: number
  paragrafo: number
  citacao_literal: string
  fenomeno_na_fala: string
  fenomeno_no_trecho: string
  probabilidade: number
  nivel: NivelInsight
}

export interface ResultadoInsight {
  cartoes: FonteInsight[]
  clarificar: boolean
  alerta_risco: boolean
  // O servidor decide numa passada só: toda resposta é a última.
  completo: true
  juiz: string
}

// Acima do máximo medido na carga (23,6 s): uma consulta presa não segura a fila da sessão.
const PRAZO_REQUISICAO_MS = 30_000

export interface ConsultaInsight {
  id: string
  frase: string
  contexto: string[]
  // Fim da última palavra, no relógio da sessão; não vai ao servidor.
  fimMs: number
  ancoras?: string[]
}

export interface BibliografiaInsight { accountId: string; accessToken: string; materialIds: string[] }

export async function consultarInsight(consulta: ConsultaInsight, signal: AbortSignal, bibliografia?: BibliografiaInsight): Promise<ResultadoInsight> {
  const resposta = await fetch(`${COPILOTO_BASE_URL}/api/consultar-qualificado`, {
    method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(PRAZO_REQUISICAO_MS)]),
    headers: { 'Content-Type': 'application/json', ...(bibliografia ? { Authorization: `Bearer ${bibliografia.accessToken}` } : {}) },
    body: JSON.stringify({ frase: consulta.frase, contexto: consulta.contexto, falante: 'paciente',
      ...(bibliografia ? { accountId: bibliografia.accountId, materialIds: bibliografia.materialIds } : {}) }),
  }).catch((erro: unknown) => { throw servicoFora(erro, signal) })
  if (!resposta.ok) {
    if (resposta.status === 503) throw new FalhaServicoInsight('nao_liberado')
    // 401 é token vencido: o SessionProvider o renova e a nova tentativa já lê o token novo.
    throw resposta.status >= 500 || resposta.status === 401 ? new FalhaServicoInsight('fora') : new Error('Consulta do copiloto recusada.')
  }
  if (resposta.headers.get('Content-Type')?.split(';')[0] !== 'application/x-ndjson' || !resposta.body) {
    throw new Error('Resposta do copiloto inválida.')
  }
  const leitor = resposta.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pendente = ''
  let final: ResultadoInsight | undefined
  const cancelar = () => { void leitor.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancelar, { once: true })
  try {
    signal.throwIfAborted()
    while (true) {
      const { value, done } = await leitor.read().catch((erro: unknown) => { throw servicoFora(erro, signal) })
      signal.throwIfAborted()
      pendente += decoder.decode(value, { stream: !done })
      if (pendente.length > 16 * 1024 * 1024) throw new Error('Resposta do copiloto inválida.')
      let fim: number
      while ((fim = pendente.indexOf('\n')) >= 0) {
        if (final) throw new Error('Resposta do copiloto inválida.')
        final = validarResultado(JSON.parse(pendente.slice(0, fim)))
        pendente = pendente.slice(fim + 1)
      }
      if (done) break
    }
    if (!final || pendente.length > 0) throw new Error('Resposta do copiloto inválida.')
    return final
  } finally {
    signal.removeEventListener('abort', cancelar)
    await leitor.cancel().catch(() => {})
    leitor.releaseLock()
  }
}

// O aborto do chamador segue como veio; rede caída ou prazo vencido é serviço fora.
function servicoFora(erro: unknown, signal: AbortSignal): unknown {
  return signal.aborted ? erro : new FalhaServicoInsight('fora')
}

function validarResultado(dados: unknown): ResultadoInsight {
  const resultado = dados as ResultadoInsight
  if (!resultado || typeof resultado !== 'object') throw new Error('Resposta do copiloto inválida.')
  if (!Array.isArray(resultado.cartoes) || typeof resultado.clarificar !== 'boolean' || typeof resultado.alerta_risco !== 'boolean' ||
      typeof resultado.juiz !== 'string' || !resultado.juiz) {
    throw new Error('Resposta do copiloto inválida.')
  }
  if (resultado.completo !== true) throw new Error('Resposta do copiloto inválida.')
  for (const fonte of resultado.cartoes) {
    if (!fonte || typeof fonte !== 'object' || typeof fonte.trecho_id !== 'string' || !fonte.trecho_id ||
        typeof fonte.titulo !== 'string' || !fonte.titulo.trim() ||
        typeof fonte.autor !== 'string' || !fonte.autor.trim() ||
        !Number.isInteger(fonte.pagina) || fonte.pagina < 1 ||
        !Number.isInteger(fonte.paragrafo) || fonte.paragrafo < 1 ||
        typeof fonte.citacao_literal !== 'string' || !fonte.citacao_literal.trim() ||
        typeof fonte.fenomeno_na_fala !== 'string' || typeof fonte.fenomeno_no_trecho !== 'string' ||
        typeof fonte.probabilidade !== 'number' || !Number.isFinite(fonte.probabilidade) || fonte.probabilidade < 0 || fonte.probabilidade > 1 ||
        (fonte.nivel !== 'forte' && fonte.nivel !== 'possivel')) {
      throw new Error('Referência do copiloto inválida.')
    }
  }
  return { cartoes: resultado.cartoes, clarificar: resultado.clarificar, alerta_risco: resultado.alerta_risco, completo: true, juiz: resultado.juiz }
}

/** true = resolvido (204 aceito, 400 inválido e inútil reenviar); qualquer outra resposta fica para reenvio. */
export async function enviarVoto(evento: EventoVoto, bibliografia: BibliografiaInsight): Promise<boolean> {
  const { v, consentiu, usuario, fala, contexto, trecho, obra, voto, juiz, em } = evento
  const resposta = await fetch(`${COPILOTO_BASE_URL}/api/votos?accountId=${encodeURIComponent(bibliografia.accountId)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bibliografia.accessToken}` },
    body: JSON.stringify({ v, consentiu, usuario, fala, contexto, trecho, obra, voto, juiz, em }),
  })
  return resposta.status === 204 || resposta.status === 400
}
