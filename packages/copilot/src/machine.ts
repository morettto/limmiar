import { assign, setup } from 'xstate'
import { separarPorAncora } from './provenancia.ts'
import type { CriarMaquinaRascunhoOpcoes, RascunhoContexto, RascunhoEvento } from './types.ts'

// Relógio injetado pelo chamador (determinístico, testável); se omitido, cai
// para o relógio real. Partilhado entre GERADO e AVISO_VENCIMENTO.
function resolverAgora(agora?: string): string {
  return agora ?? new Date().toISOString()
}

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
                criadaEm: resolverAgora(event.agora),
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
            actions: assign({ avisoEmitidoEm: ({ event }) => resolverAgora(event.agora) }),
          },
          // Rede de segurança: se o adapter disparar VENCEU direto a partir de
          // `rascunho`, sem passar por `aVencer`, o rascunho ainda é descartado
          // aos 30 dias como a spec S07 promete — ver machine.test.ts.
          VENCEU: 'descartado',
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
