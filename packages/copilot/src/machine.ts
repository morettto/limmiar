import { assign, setup } from 'xstate'
import { separarPorAncora } from './provenancia.ts'
import type { CriarMaquinaRascunhoOpcoes, RascunhoContexto, RascunhoEvento } from './types.ts'

export function criarMaquinaRascunho(opcoes: CriarMaquinaRascunhoOpcoes) {
  return setup({
    types: {
      context: {} as RascunhoContexto,
      events: {} as RascunhoEvento,
    },
  }).createMachine({
    id: 'rascunho',
    context: {
      id: opcoes.id,
      criadaEm: null,
      afirmacoes: [],
      afirmacoesDescartadasSemAncora: 0,
      avisoEmitidoEm: null,
    },
    initial: 'gerando',
    states: {
      gerando: {
        on: {
          GERADO: {
            target: 'rascunho',
            // Único ponto de entrada de afirmações: o filtro corre aqui, não
            // confia em o chamador já ter filtrado — ver machine.test.ts,
            // teste adversário de procedência.
            actions: assign(({ event }) => {
              const { comAncora, descartadas } = separarPorAncora(event.afirmacoes)
              return {
                afirmacoes: comAncora,
                afirmacoesDescartadasSemAncora: descartadas,
                criadaEm: event.agora ?? new Date().toISOString(),
              }
            }),
          },
        },
      },
      rascunho: {
        on: {
          APROVAR: 'aprovado',
          DESCARTAR: 'descartado',
          AVISO_VENCIMENTO: {
            target: 'aVencer',
            actions: assign({ avisoEmitidoEm: ({ event }) => event.agora ?? new Date().toISOString() }),
          },
        },
      },
      aVencer: {
        on: {
          APROVAR: 'aprovado',
          DESCARTAR: 'descartado',
          VENCEU: 'descartado',
        },
      },
      aprovado: { type: 'final' },
      descartado: { type: 'final' },
    },
  })
}
