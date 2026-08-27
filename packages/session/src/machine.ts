import { assign, setup } from 'xstate'
import type { CriarMaquinaSessaoOpcoes, SessaoContexto, SessaoEvento } from './types.ts'

export function criarMaquinaSessao(opcoes: CriarMaquinaSessaoOpcoes = {}) {
  // Factory: a configuração inteira é montada em runtime, `initial` incluído — sem precisar de estado transiente.
  const estadoInicial = (opcoes.chunksOrfaos ?? 0) > 0 ? 'recuperando' : 'aguardandoConsentimento'

  return setup({
    types: {
      context: {} as SessaoContexto,
      events: {} as SessaoEvento,
    },
  }).createMachine({
    id: 'sessao',
    context: {
      chunksPersistidos: 0,
      // Sem isto, `recuperando` chegaria a `ativa` sem prova de consentimento no contexto.
      consentimentoEm: opcoes.consentimentoEm ?? null,
      marcos: [],
      ultimaFalha: null,
    },
    initial: estadoInicial,
    states: {
      aguardandoConsentimento: {
        on: {
          CONSENTIMENTO_CONCEDIDO: {
            target: 'ativa.aquecendoModelo',
            // Carimbo do relógio local: sinal de UI, não prova de consentimento (ver README).
            actions: assign({ consentimentoEm: () => new Date().toISOString() }),
          },
          ENCERRAR: 'encerrado',
        },
      },
      ativa: {
        // As três falhas de hardware/disco vivem aqui, uma única vez: `ativa`
        // é exatamente o conjunto de estados (aquecendoModelo, gravando,
        // pausado) que detém hardware ou escreve em disco — ver ADR-0008.
        on: {
          MICROFONE_REVOGADO: {
            target: 'interrompido',
            actions: assign({ ultimaFalha: () => ({ tipo: 'microfone-revogado' as const }) }),
          },
          GPU_PERDIDA: {
            target: 'interrompido',
            actions: assign({ ultimaFalha: () => ({ tipo: 'gpu-perdida' as const }) }),
          },
          DISCO_CHEIO: {
            target: 'interrompido',
            actions: assign({
              ultimaFalha: ({ event }) => ({ tipo: 'disco-cheio' as const, bytesLivres: event.bytesLivres }),
            }),
          },
          ENCERRAR: 'encerrando',
        },
        initial: 'aquecendoModelo',
        states: {
          aquecendoModelo: {
            on: { MODELO_PRONTO: 'gravando.online' },
          },
          gravando: {
            initial: 'online',
            states: {
              online: {
                on: {
                  REDE_CAIU: 'offline',
                  PAUSAR: '#sessao.ativa.pausado',
                  CHUNK_PERSISTIDO: {
                    actions: assign({ chunksPersistidos: ({ context }) => context.chunksPersistidos + 1 }),
                  },
                  MARCAR_MOMENTO: {
                    actions: assign({
                      marcos: ({ context, event }) => [...context.marcos, { offsetMs: event.offsetMs }],
                    }),
                  },
                },
              },
              offline: {
                on: {
                  REDE_VOLTOU: 'online',
                  DISPOSITIVO_SUSPENSO: '#sessao.ativa.pausado',
                },
              },
              historico: { type: 'history', history: 'shallow' },
            },
          },
          pausado: {
            on: { RETOMAR: 'gravando.historico' },
          },
        },
      },
      recuperando: {
        on: {
          RECUPERACAO_CONCLUIDA: {
            target: 'ativa.pausado',
            actions: assign({ chunksPersistidos: ({ event }) => event.chunksRecuperados }),
          },
          RECUPERACAO_FALHOU: {
            target: 'interrompido',
            actions: assign({
              ultimaFalha: ({ event }) => ({ tipo: 'recuperacao-falhou' as const, motivo: event.motivo }),
            }),
          },
          ENCERRAR: 'encerrando',
        },
      },
      interrompido: {
        on: {
          TENTAR_NOVAMENTE: {
            target: 'ativa.aquecendoModelo',
            actions: assign({ ultimaFalha: () => null }),
          },
          ENCERRAR: 'encerrando',
        },
      },
      encerrando: {
        // A gravação já está em disco e o passe corre fora da máquina — falha aqui
        // não reabre `ativa` (TENTAR_NOVAMENTE reabriria o microfone à toa).
        initial: 'drenandoFila',
        states: {
          drenandoFila: {
            on: { FILA_DRENADA: 'passeCanonico' },
          },
          passeCanonico: {
            on: {
              PASSE_CANONICO_CONCLUIDO: '#sessao.encerrado',
              PASSE_CANONICO_FALHOU: {
                target: '#sessao.encerrado',
                actions: assign({
                  ultimaFalha: ({ event }) => ({ tipo: 'passe-canonico-falhou' as const, motivo: event.motivo }),
                }),
              },
            },
          },
        },
      },
      encerrado: { type: 'final' },
    },
  })
}
