export interface Marco {
  offsetMs: number
}

export type Falha =
  | { tipo: 'microfone-revogado' }
  | { tipo: 'gpu-perdida' }
  | { tipo: 'disco-cheio'; bytesLivres: number }
  | { tipo: 'recuperacao-falhou'; motivo: string }

export interface SessaoContexto {
  chunksPersistidos: number
  consentimentoEm: string | null
  marcos: Marco[]
  ultimaFalha: Falha | null
}

export type SessaoEvento =
  | { type: 'CONSENTIMENTO_CONCEDIDO' }
  | { type: 'ENCERRAR' }
  | { type: 'MODELO_PRONTO' }
  | { type: 'REDE_CAIU' }
  | { type: 'REDE_VOLTOU' }
  | { type: 'PAUSAR' }
  | { type: 'DISPOSITIVO_SUSPENSO' }
  | { type: 'RETOMAR' }
  | { type: 'CHUNK_PERSISTIDO' }
  | { type: 'MARCAR_MOMENTO'; offsetMs: number }
  | { type: 'MICROFONE_REVOGADO' }
  | { type: 'GPU_PERDIDA' }
  | { type: 'DISCO_CHEIO'; bytesLivres: number }
  | { type: 'TENTAR_NOVAMENTE' }
  | { type: 'RECUPERACAO_CONCLUIDA'; chunksRecuperados: number }
  | { type: 'RECUPERACAO_FALHOU'; motivo: string }
  | { type: 'FILA_DRENADA' }

export interface CriarMaquinaSessaoOpcoes {
  chunksOrfaos?: number
  // Consentimento herdado de uma sessão anterior — ver README, "Decisão em aberto".
  consentimentoEm?: string
}
