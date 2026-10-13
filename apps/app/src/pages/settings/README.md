# pages/settings

## Responsabilidade

Telas de configuração da conta profissional. `CopilotPage` monta a rota `/settings/copilot`
(`app/routing/router.tsx`, `copilotSettingsRoute`): a única opção é o interruptor que liga ou
desliga o envio dos votos "útil / não útil" do copiloto
(`features/consentimento-votos/ConsentimentoVotos`).

## Fluxo principal

1. `CopilotRouteComponent` (`router.tsx`) exige conta profissional: sem sessão ou com conta de
   paciente redireciona para `/`. Com ela, monta `CopilotPage` com o `accountId` da sessão --
   o mesmo molde de `/settings/audit` e `/settings/voice`.
2. `CopilotPage` mostra o título, um aviso de que os votos ficam
   cifrados neste aparelho e só saem se a opção estiver ligada, e o interruptor.
3. A escolha é por conta, em `localStorage` (`entities/insight/consentimento-voto.ts`). A primeira
   pergunta aparece no primeiro voto, em `features/live-session/LiveInsights`.

## Pontos de entrada

- `CopilotPage({ accountId })` (`CopilotPage.tsx`).
- `AuditPage` (`AuditPage.tsx`) e `VoicePage` (`VoicePage.tsx`), montadas por
  `/settings/audit` e `/settings/voice`.

## Decisões relevantes

- **A configuração de chave de API (BYOK) foi retirada da V1.** A página de chave, o
  formulário e o armazenamento da chave e o teste de CORS dos provedores saíram juntos; a chamada ao copiloto
  vai só para o orquestrador do produto, na mesma origem do app.
