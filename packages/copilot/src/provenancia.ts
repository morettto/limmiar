import type { Afirmacao } from './types.ts'

const DIA_MS = 24 * 60 * 60 * 1000
const JANELA_AVISO_MS = 23 * DIA_MS
const PRAZO_DESCARTE_MS = 30 * DIA_MS

export function separarPorAncora(afirmacoes: readonly Afirmacao[]): { comAncora: Afirmacao[]; descartadas: number } {
  const comAncora = afirmacoes.filter((afirmacao) => afirmacao.ancoras.length > 0)
  return { comAncora, descartadas: afirmacoes.length - comAncora.length }
}

function decorridoMs(criadaEm: string, agora: string): number {
  return Date.parse(agora) - Date.parse(criadaEm)
}

export function deveAvisarVencimento(criadaEm: string, agora: string): boolean {
  const decorrido = decorridoMs(criadaEm, agora)
  return decorrido >= JANELA_AVISO_MS && decorrido < PRAZO_DESCARTE_MS
}

export function deveDescartarPorVencimento(criadaEm: string, agora: string): boolean {
  return decorridoMs(criadaEm, agora) >= PRAZO_DESCARTE_MS
}
