# @limmiar/copilot

## Responsabilidade

Entidade de rascunho gerado por copiloto de IA (spec S07, BYOK) e a camada de procedência que a governa: cada afirmação do rascunho só sobrevive se tiver pelo menos uma âncora temporal no áudio de origem, e o próprio rascunho tem um prazo de vida (aviso aos 23 dias, descarte aos 30). Pacote puro, sem `invoke`, sem UI, sem chamada a LLM — testável em Node, seguindo o mesmo padrão de `packages/session`: todo efeito do mundo real (gerar o rascunho, notificar vencimento, persistir) entra/sai como evento explícito de um adapter fora deste package.

## Fluxo principal (`criarMaquinaRascunho`)

1. `criarMaquinaRascunho({ id })` constrói a máquina XState v5 (`setup` + `createMachine`), pronta para `createActor(...).start()`. Contexto inicial: `{ id, criadaEm: null, afirmacoes: [], afirmacoesDescartadasSemAncora: 0, avisoEmitidoEm: null }`, estado inicial `gerando`.
2. `gerando` é o **único** ponto de entrada de afirmações: `GERADO` (com `afirmacoes` e opcionalmente `agora`) chama `separarPorAncora` e grava só as afirmações com `ancoras.length > 0` em `context.afirmacoes`; a contagem das descartadas fica em `afirmacoesDescartadasSemAncora`. O filtro corre dentro da máquina — nunca confia em o chamador já ter filtrado (ver teste adversário em `machine.test.ts`). Transita para `rascunho`.
3. `rascunho`: `APROVAR` → `aprovado` (final); `DESCARTAR` → `descartado` (final, descarte direto sem passar por aviso); `AVISO_VENCIMENTO` → `aVencer`, gravando `avisoEmitidoEm`; `VENCEU` → `descartado` diretamente (rede de segurança, caso o adapter perca a janela de aviso).
4. `aVencer`: `APROVAR` → `aprovado`; `DESCARTAR` → `descartado`; `VENCEU` → `descartado`.
5. `agora` nos eventos `GERADO`/`AVISO_VENCIMENTO` é o relógio injetado pelo chamador (determinístico, testável); se omitido, cai para `new Date().toISOString()`.

## Camada de procedência (`src/provenancia.ts`)

- `separarPorAncora(afirmacoes)` — mantém só afirmações com `ancoras.length > 0`; devolve `{ comAncora, descartadas }`. `Ancora` (`{ inicioMs, fimMs }`) é compatível em forma com o intervalo de tempo de `PalavraAsr` em `packages/diarization`, mas é um tipo próprio deste package, não importado: `PalavraAsr` carrega `texto` e outros campos de transcrição que uma citação não precisa, e este package não depende de `diarization`.
- `deveAvisarVencimento(criadaEm, agora)` — `true` na janela `[23 dias, 30 dias)` desde `criadaEm`.
- `deveDescartarPorVencimento(criadaEm, agora)` — `true` a partir dos 30 dias (`>=`).
- Estas duas funções são puras e não mexem no contexto da máquina diretamente — o adapter fora do package é responsável por chamá-las (ex.: num timer) e enviar `AVISO_VENCIMENTO`/`VENCEU` como eventos.

## Pontos de entrada

- `criarMaquinaRascunho(opcoes: CriarMaquinaRascunhoOpcoes)` — factory da máquina.
- `separarPorAncora`, `deveAvisarVencimento`, `deveDescartarPorVencimento` — funções puras de `src/provenancia.ts`.
- Tipos: `RascunhoContexto`, `RascunhoEvento`, `Afirmacao`, `Ancora`, `CriarMaquinaRascunhoOpcoes`, `NotificadorVencimentoRascunho` (`src/types.ts`, zero import de `xstate` — regra aplicada por `pnpm lint:arch`).
- `NotificadorVencimentoRascunho.avisar(rascunhoId: string)` — porta de notificação de vencimento. A assinatura só aceita o id do rascunho, nunca texto ou afirmações: impossível, por construção do tipo, vazar dado clínico por esta porta.

## Decisões recentes relevantes

O prazo de 30 dias e a janela de aviso de 7 dias (23→30) são constantes fixas dentro de `provenancia.ts`, não configuráveis por opção — nenhum consumidor atual precisa de um valor diferente; se precisar, essa é uma extensão da assinatura, não deste ficheiro.

## Fora de âmbito

- Chamada real a um LLM para gerar o rascunho — fica para ticket futuro da spec S07.
- Envio real da notificação de vencimento — a porta `NotificadorVencimentoRascunho` está definida aqui; a implementação (browser `Notification`, e-mail, painel) é trabalho de adapter fora deste package.
- Persistência do rascunho (disco/servidor) — fora de âmbito; ver S07-01 para o padrão de envelope já usado no resto do BYOK.
