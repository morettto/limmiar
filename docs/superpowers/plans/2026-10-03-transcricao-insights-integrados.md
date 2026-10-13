# Transcrição e insights integrados — Implementation Plan

**Goal:** Exibir a transcrição completa e vincular cada fala qualificada a todas as suas fontes.

**Architecture:** `LiveInsights` compõe a transcrição e o painel de referências a partir
da fila existente. Uma função pura agrupa palavras sem perder fala desconhecida ou
hipóteses e preserva os IDs usados pela seleção de consultas. `SessionReview` mantém
captura, revisão e ciframento, removendo apenas a lista duplicada de transcrição.

**Tech Stack:** React 19, TypeScript, Lingui, Vitest, Playwright e tokens `@limmiar/ui` existentes.

**Spec:** `docs/v1-criterios-de-aceite.md`, seção Transcrição e insights.

## Global Constraints

- Não armazenar áudio nem mudar o gate de qualificação do juiz.
- Somente fala estável do paciente gera consultas; toda palavra recebida aparece na transcrição.
- Sem novas dependências; todas as mensagens visíveis têm quatro traduções.
- Execução nesta conversa já autorizada pelo usuário; sem criar tarefas ou commits.

## Task 1: Agrupamento sem perda e vínculo por fala

**Files:** criar `apps/app/src/entities/insight/linhas-transcricao.ts` e seu teste.

**Interfaces:** consumir `PalavraAtribuida[]`, mapa de `RotuloLocutor | null` e
`ConsultaInsight[]`; produzir linhas com `id`, `texto`, `papel`, `inicioMs` e
`consultaId: string | null`.

- [x] Testar profissional, paciente, desconhecido, pontuação, próxima hipótese e
  fronteiras de consultas, comparando a concatenação das palavras antes/depois.
- [x] Implementar correspondência literal à consulta; linha corrigida nunca
  herda o ID de uma consulta com texto anterior.
- [x] Executar Vitest desse módulo antes de ligar a UI.

## Task 2: Tracejado acionável e referências

**Files:** modificar `apps/app/src/features/live-session/LiveInsights.tsx`, seus
testes e `SessionReview.tsx`; criar `transcricao.css` na mesma feature.

**Interfaces:** `LiveInsights` recebe as palavras/papéis/estabilidade/consentimento
existentes e callback de escuta opcional somente enquanto houver áudio em memória.

- [x] Renderizar todas as linhas; somente resultado atual com cartões ou alertas
  cria botão tracejado. O botão controla o balão correspondente por `aria-controls`.
- [x] Clique abre o balão, transfere foco para seu resumo e preserva todas as fontes.
- [x] Testar texto/papel/contexto/consentimento corrigidos removendo marca e fontes.
- [x] Remover a transcrição duplicada de `SessionReview` e manter revisão/histórico.
- [x] Executar regressões de sessão, build, lint, arquitetura e traduções.
- [x] Provar no navegador desktop/celular clique por fala, retorno ao texto,
  ausência de overflow e axe; fixtures de fontes ficam explicitamente sintéticas.

Evidência: 980 testes, 100% nas quatro métricas; build/lint/arquitetura sem erros.
E2E real da composição em `.local/insights-transcricao-e2e.log` (31,3 s), com
Nemotron real e fontes sintéticas explícitas. O juiz permanece bloqueado.
