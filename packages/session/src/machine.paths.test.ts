import { createTestModel } from '@xstate/test'
import type { AnyMachineSnapshot } from 'xstate'
import { describe, expect, it } from 'vitest'
import { criarMaquinaSessao } from './machine.ts'
import type { SessaoEvento } from './types.ts'

// Um exemplo por tipo de evento, com `Record` sobre a união `SessaoEvento['type']`:
// esquecer um evento novo aqui vira erro de compilação, não cobertura silenciosamente
// desatualizada.
const exemplos: { [K in SessaoEvento['type']]: Extract<SessaoEvento, { type: K }> } = {
  CONSENTIMENTO_CONCEDIDO: { type: 'CONSENTIMENTO_CONCEDIDO', concedidoEm: '2026-08-28T12:00:00.000Z' },
  ENCERRAR: { type: 'ENCERRAR' },
  MODELO_PRONTO: { type: 'MODELO_PRONTO' },
  REDE_CAIU: { type: 'REDE_CAIU' },
  REDE_VOLTOU: { type: 'REDE_VOLTOU' },
  PAUSAR: { type: 'PAUSAR' },
  DISPOSITIVO_SUSPENSO: { type: 'DISPOSITIVO_SUSPENSO' },
  RETOMAR: { type: 'RETOMAR' },
  CHUNK_PERSISTIDO: { type: 'CHUNK_PERSISTIDO' },
  MARCAR_MOMENTO: { type: 'MARCAR_MOMENTO', offsetMs: 900_000 },
  MICROFONE_REVOGADO: { type: 'MICROFONE_REVOGADO' },
  GPU_PERDIDA: { type: 'GPU_PERDIDA' },
  DISCO_CHEIO: { type: 'DISCO_CHEIO', bytesLivres: 0 },
  TENTAR_NOVAMENTE: { type: 'TENTAR_NOVAMENTE' },
  RECUPERACAO_CONCLUIDA: { type: 'RECUPERACAO_CONCLUIDA', chunksRecuperados: 7 },
  RECUPERACAO_FALHOU: { type: 'RECUPERACAO_FALHOU', motivo: 'chunk-corrompido' },
  FILA_DRENADA: { type: 'FILA_DRENADA' },
  PASSE_CANONICO_CONCLUIDO: { type: 'PASSE_CANONICO_CONCLUIDO' },
  PASSE_CANONICO_FALHOU: { type: 'PASSE_CANONICO_FALHOU', motivo: 'transcricao-invalida' },
}
const eventosDeExemplo: SessaoEvento[] = Object.values(exemplos)

// `serializeState` ignora o contexto: eventos como CHUNK_PERSISTIDO fazem transição
// interna (mesmo estado, contexto novo) e a travessia nunca terminaria. Aqui importa a
// topologia; os valores de contexto têm cobertura própria em machine.test.ts.
const opcoesTravessia = {
  events: eventosDeExemplo,
  serializeState: (snapshot: AnyMachineSnapshot) => JSON.stringify(snapshot.value),
}

const modeloSemOrfaos = createTestModel(criarMaquinaSessao({ chunksOrfaos: 0 }), opcoesTravessia)
const modeloComOrfaos = createTestModel(criarMaquinaSessao({ chunksOrfaos: 7 }), opcoesTravessia)

describe('caminhos alcançáveis a partir de aguardandoConsentimento', () => {
  // `getShortestPaths` deduplica: um caminho A→B não vira o seu próprio teste
  // quando já existe um caminho mais longo A→B→C (B continua exercitado, só
  // não ganha um `it` isolado) — ver README do @xstate/test.
  modeloSemOrfaos.getShortestPaths().forEach((path) => {
    it(path.description, () => {
      path.testSync({})
    })
  })
})

describe('caminhos alcançáveis a partir de recuperando', () => {
  modeloComOrfaos.getShortestPaths().forEach((path) => {
    it(path.description, () => {
      path.testSync({})
    })
  })
})

describe('cobertura de estados exigida pelo critério de aceite', () => {
  it('inclui recuperando e interrompido entre os estados alcançados', () => {
    // A lista de adjacência é o grafo bruto (sem a deduplicação de caminhos
    // de getShortestPaths), por isso é a fonte correta para verificar que um
    // estado nomeado foi mesmo visitado pela travessia.
    const estadosAlcancados = [...modeloSemOrfaos.getAdjacencyList(), ...modeloComOrfaos.getAdjacencyList()].flatMap(
      ({ state, nextState }) => [JSON.stringify(state.value), JSON.stringify(nextState.value)],
    )

    expect(estadosAlcancados).toContain(JSON.stringify('recuperando'))
    expect(estadosAlcancados).toContain(JSON.stringify('interrompido'))
    expect(estadosAlcancados).toContain(JSON.stringify('aguardandoConsentimento'))
    expect(estadosAlcancados).toContain(JSON.stringify({ ativa: 'aquecendoModelo' }))
    expect(estadosAlcancados).toContain(JSON.stringify({ ativa: { gravando: 'online' } }))
    expect(estadosAlcancados).toContain(JSON.stringify({ ativa: { gravando: 'offline' } }))
    expect(estadosAlcancados).toContain(JSON.stringify({ ativa: 'pausado' }))
    expect(estadosAlcancados).toContain(JSON.stringify({ encerrando: 'drenandoFila' }))
    expect(estadosAlcancados).toContain(JSON.stringify({ encerrando: 'passeCanonico' }))
    expect(estadosAlcancados).toContain(JSON.stringify('encerrado'))
  })
})
