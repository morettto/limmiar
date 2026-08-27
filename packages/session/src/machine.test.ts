import { createActor } from 'xstate'
import { describe, expect, it } from 'vitest'
import { criarMaquinaSessao } from './machine.ts'
import type { CriarMaquinaSessaoOpcoes } from './types.ts'

function iniciar(opcoes?: CriarMaquinaSessaoOpcoes) {
  const actor = createActor(criarMaquinaSessao(opcoes))
  actor.start()
  return actor
}

function criarAtivaAquecendo() {
  const actor = iniciar()
  actor.send({ type: 'CONSENTIMENTO_CONCEDIDO' })
  return actor
}

function criarGravandoOnline() {
  const actor = criarAtivaAquecendo()
  actor.send({ type: 'MODELO_PRONTO' })
  return actor
}

function criarGravandoOffline() {
  const actor = criarGravandoOnline()
  actor.send({ type: 'REDE_CAIU' })
  return actor
}

// Tabela de mesa completa em S05-01 do ticket, uma linha por teste.

describe('inicialização', () => {
  it('1. máquina criada com chunksOrfaos: 0 entra em aguardandoConsentimento', () => {
    const actor = iniciar()
    const snapshot = actor.getSnapshot()
    expect(snapshot.value).toBe('aguardandoConsentimento')
    expect(snapshot.context.consentimentoEm).toBeNull()
  })

  it('18. máquina criada com chunksOrfaos: 7 entra em recuperando', () => {
    const actor = iniciar({ chunksOrfaos: 7 })
    expect(actor.getSnapshot().value).toBe('recuperando')
  })
})

describe('aguardandoConsentimento', () => {
  it('2. CONSENTIMENTO_CONCEDIDO leva a ativa.aquecendoModelo e regista consentimentoEm', () => {
    const actor = criarAtivaAquecendo()
    const snapshot = actor.getSnapshot()
    expect(snapshot.value).toEqual({ ativa: 'aquecendoModelo' })
    expect(typeof snapshot.context.consentimentoEm).toBe('string')
  })

  it('3. ENCERRAR leva direto a encerrado', () => {
    const actor = iniciar()
    actor.send({ type: 'ENCERRAR' })
    expect(actor.getSnapshot().value).toBe('encerrado')
  })
})

describe('ativa.aquecendoModelo', () => {
  it('4. MODELO_PRONTO leva a ativa.gravando.online', () => {
    const actor = criarGravandoOnline()
    expect(actor.getSnapshot().value).toEqual({ ativa: { gravando: 'online' } })
  })

  it('12. MICROFONE_REVOGADO leva a interrompido com a falha registada', () => {
    const actor = criarAtivaAquecendo()
    actor.send({ type: 'MICROFONE_REVOGADO' })
    const snapshot = actor.getSnapshot()
    expect(snapshot.value).toBe('interrompido')
    expect(snapshot.context.ultimaFalha).toEqual({ tipo: 'microfone-revogado' })
  })
})

describe('ativa.gravando.online', () => {
  it('5. REDE_CAIU leva a ativa.gravando.offline', () => {
    const actor = criarGravandoOffline()
    expect(actor.getSnapshot().value).toEqual({ ativa: { gravando: 'offline' } })
  })

  it('7. PAUSAR leva a ativa.pausado', () => {
    const actor = criarGravandoOnline()
    actor.send({ type: 'PAUSAR' })
    expect(actor.getSnapshot().value).toEqual({ ativa: 'pausado' })
  })

  it('10. CHUNK_PERSISTIDO ×3 mantém o estado e conta 3 chunks persistidos', () => {
    const actor = criarGravandoOnline()
    actor.send({ type: 'CHUNK_PERSISTIDO' })
    actor.send({ type: 'CHUNK_PERSISTIDO' })
    actor.send({ type: 'CHUNK_PERSISTIDO' })
    const snapshot = actor.getSnapshot()
    expect(snapshot.value).toEqual({ ativa: { gravando: 'online' } })
    expect(snapshot.context.chunksPersistidos).toBe(3)
  })

  it('11. MARCAR_MOMENTO mantém o estado e regista o marco', () => {
    const actor = criarGravandoOnline()
    actor.send({ type: 'MARCAR_MOMENTO', offsetMs: 900_000 })
    const snapshot = actor.getSnapshot()
    expect(snapshot.value).toEqual({ ativa: { gravando: 'online' } })
    expect(snapshot.context.marcos).toEqual([{ offsetMs: 900_000 }])
  })

  it('13. GPU_PERDIDA leva a interrompido com a falha registada', () => {
    const actor = criarGravandoOnline()
    actor.send({ type: 'GPU_PERDIDA' })
    const snapshot = actor.getSnapshot()
    expect(snapshot.value).toBe('interrompido')
    expect(snapshot.context.ultimaFalha).toEqual({ tipo: 'gpu-perdida' })
  })

  it('22. ENCERRAR leva a encerrando', () => {
    const actor = criarGravandoOnline()
    actor.send({ type: 'ENCERRAR' })
    expect(actor.getSnapshot().matches('encerrando')).toBe(true)
  })
})

describe('ativa.gravando.offline', () => {
  it('6. REDE_VOLTOU leva a ativa.gravando.online', () => {
    const actor = criarGravandoOffline()
    actor.send({ type: 'REDE_VOLTOU' })
    expect(actor.getSnapshot().value).toEqual({ ativa: { gravando: 'online' } })
  })

  it('8. DISPOSITIVO_SUSPENSO leva a ativa.pausado', () => {
    const actor = criarGravandoOffline()
    actor.send({ type: 'DISPOSITIVO_SUSPENSO' })
    expect(actor.getSnapshot().value).toEqual({ ativa: 'pausado' })
  })

  it('14. DISCO_CHEIO leva a interrompido com bytesLivres registado', () => {
    const actor = criarGravandoOffline()
    actor.send({ type: 'DISCO_CHEIO', bytesLivres: 0 })
    const snapshot = actor.getSnapshot()
    expect(snapshot.value).toBe('interrompido')
    expect(snapshot.context.ultimaFalha).toEqual({ tipo: 'disco-cheio', bytesLivres: 0 })
  })
})

describe('ativa.pausado', () => {
  it('9. RETOMAR volta a ativa.gravando.offline via histórico (veio de offline)', () => {
    const actor = criarGravandoOffline()
    actor.send({ type: 'DISPOSITIVO_SUSPENSO' })
    actor.send({ type: 'RETOMAR' })
    expect(actor.getSnapshot().value).toEqual({ ativa: { gravando: 'offline' } })
  })

  it('15. DISCO_CHEIO leva a interrompido', () => {
    const actor = criarGravandoOnline()
    actor.send({ type: 'PAUSAR' })
    actor.send({ type: 'DISCO_CHEIO', bytesLivres: 1_000 })
    expect(actor.getSnapshot().value).toBe('interrompido')
  })
})

describe('interrompido', () => {
  function criarInterrompido() {
    const actor = criarAtivaAquecendo()
    actor.send({ type: 'MICROFONE_REVOGADO' })
    return actor
  }

  it('16. TENTAR_NOVAMENTE leva a ativa.aquecendoModelo e limpa a última falha', () => {
    const actor = criarInterrompido()
    actor.send({ type: 'TENTAR_NOVAMENTE' })
    const snapshot = actor.getSnapshot()
    expect(snapshot.value).toEqual({ ativa: 'aquecendoModelo' })
    expect(snapshot.context.ultimaFalha).toBeNull()
  })

  it('17. ENCERRAR leva a encerrando', () => {
    const actor = criarInterrompido()
    actor.send({ type: 'ENCERRAR' })
    expect(actor.getSnapshot().matches('encerrando')).toBe(true)
  })
})

describe('recuperando', () => {
  it('19. RECUPERACAO_CONCLUIDA leva a ativa.pausado e regista os chunks recuperados', () => {
    const actor = iniciar({ chunksOrfaos: 7 })
    actor.send({ type: 'RECUPERACAO_CONCLUIDA', chunksRecuperados: 7 })
    const snapshot = actor.getSnapshot()
    expect(snapshot.value).toEqual({ ativa: 'pausado' })
    expect(snapshot.context.chunksPersistidos).toBe(7)
  })

  it('20. RECUPERACAO_FALHOU leva a interrompido com o motivo registado', () => {
    const actor = iniciar({ chunksOrfaos: 7 })
    actor.send({ type: 'RECUPERACAO_FALHOU', motivo: 'chunk-corrompido' })
    const snapshot = actor.getSnapshot()
    expect(snapshot.value).toBe('interrompido')
    expect(snapshot.context.ultimaFalha).toEqual({ tipo: 'recuperacao-falhou', motivo: 'chunk-corrompido' })
  })

  it('21. ENCERRAR leva a encerrando', () => {
    const actor = iniciar({ chunksOrfaos: 7 })
    actor.send({ type: 'ENCERRAR' })
    expect(actor.getSnapshot().matches('encerrando')).toBe(true)
  })
})

describe('encerrando', () => {
  function criarEncerrandoDrenandoFila() {
    const actor = criarGravandoOnline()
    actor.send({ type: 'ENCERRAR' })
    return actor
  }

  it('23. FILA_DRENADA leva a encerrando.passeCanonico, ainda não a encerrado', () => {
    const actor = criarEncerrandoDrenandoFila()
    actor.send({ type: 'FILA_DRENADA' })
    const snapshot = actor.getSnapshot()
    expect(snapshot.value).toEqual({ encerrando: 'passeCanonico' })
    expect(snapshot.matches('encerrando')).toBe(true)
    expect(snapshot.status).toBe('active')
  })

  it('25. PASSE_CANONICO_CONCLUIDO leva a encerrado (estado final)', () => {
    const actor = criarEncerrandoDrenandoFila()
    actor.send({ type: 'FILA_DRENADA' })
    actor.send({ type: 'PASSE_CANONICO_CONCLUIDO' })
    const snapshot = actor.getSnapshot()
    expect(snapshot.value).toBe('encerrado')
    expect(snapshot.status).toBe('done')
  })

  it('26. PASSE_CANONICO_FALHOU leva a encerrado com a falha registada', () => {
    const actor = criarEncerrandoDrenandoFila()
    actor.send({ type: 'FILA_DRENADA' })
    actor.send({ type: 'PASSE_CANONICO_FALHOU', motivo: 'transcricao-invalida' })
    const snapshot = actor.getSnapshot()
    expect(snapshot.value).toBe('encerrado')
    expect(snapshot.status).toBe('done')
    expect(snapshot.context.ultimaFalha).toEqual({ tipo: 'passe-canonico-falhou', motivo: 'transcricao-invalida' })
  })
})

describe('encerrado', () => {
  it('24. qualquer evento é absorvido, o estado final não muda', () => {
    const actor = criarGravandoOnline()
    actor.send({ type: 'ENCERRAR' })
    actor.send({ type: 'FILA_DRENADA' })
    actor.send({ type: 'PASSE_CANONICO_CONCLUIDO' })
    actor.send({ type: 'ENCERRAR' })
    actor.send({ type: 'MODELO_PRONTO' })
    expect(actor.getSnapshot().value).toBe('encerrado')
  })
})
