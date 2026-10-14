# consentimento-votos

## Responsabilidade

`ConsentimentoVotos` é o interruptor que liga ou desliga o envio dos votos "útil / não útil"
do copiloto ao servidor. O valor fica por conta em `localStorage`
(`entities/insight/consentimento-voto.ts`: `"sim"`, `"nao"` ou ausente = ainda não perguntado).

## Fluxo principal

1. O componente nasce ligado só se a conta já gravou `"sim"`.
2. Cada mudança grava `"sim"` ou `"nao"` na hora. Votos já guardados não são reescritos:
   o voto novo nasce com `consentiu` conforme a escolha vigente.
3. A primeira pergunta, no primeiro voto, é feita em `features/live-session/LiveInsights`;
   este interruptor é o lugar para mudar de ideia depois.

## Pontos de entrada

- `ConsentimentoVotos` (`ConsentimentoVotos.tsx`) -- props `accountId`; `role="switch"`.
  Montado por `pages/settings/CopilotPage.tsx`, na rota `/settings/copilot`.
