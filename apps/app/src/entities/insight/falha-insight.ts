export type FalhaInsight = 'nao_liberado' | 'fora' | 'sem_analise'

/** Falha do serviço, não da fala: 503 é `nao_liberado`; rede, prazo e 5xx são `fora`. */
export class FalhaServicoInsight extends Error {
  falha: Exclude<FalhaInsight, 'sem_analise'>
  constructor(falha: Exclude<FalhaInsight, 'sem_analise'>) {
    super(falha)
    this.falha = falha
  }
}

/** Qualquer outro erro (resposta inválida, 4xx, erro no stream) vale só para a fala que o causou. */
export function falhaDe(erro: unknown): FalhaInsight {
  return erro instanceof FalhaServicoInsight ? erro.falha : 'sem_analise'
}
