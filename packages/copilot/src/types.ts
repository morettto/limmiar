export interface Ancora {
  inicioMs: number
  fimMs: number
}

export interface Afirmacao {
  texto: string
  ancoras: readonly Ancora[]
}

export interface RascunhoContexto {
  id: string
  criadaEm: string | null // ISO; null enquanto está em `gerando`
  afirmacoes: readonly Afirmacao[] // já filtradas — nunca contém afirmação sem âncora
  afirmacoesDescartadasSemAncora: number
  avisoEmitidoEm: string | null // ISO; preenchido ao entrar em `aVencer`
}

export type RascunhoEvento =
  | { type: 'GERADO'; afirmacoes: readonly Afirmacao[]; agora?: string }
  | { type: 'APROVAR' }
  | { type: 'DESCARTAR' }
  | { type: 'AVISO_VENCIMENTO'; agora?: string }
  | { type: 'VENCEU' }

export interface CriarMaquinaRascunhoOpcoes {
  id: string
}
