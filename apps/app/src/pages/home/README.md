# pages/home

## Responsabilidade

Casca de navegação montada na rota `/` (`app/routing/router.tsx`). Continua fina de
propósito: só o link para `/settings/copilot`, a conta em sessão + botão "Sair"
condicionais a `email`, e — desde o ticket S09-01 — a montagem do painel
profissional (`widgets/painel-profissional/PainelProfissional.tsx`), repassando
direto as props que recebe. Não decide nada do painel; só o conecta.

## Fluxo principal

1. Sempre renderiza `<div id="app-shell">` com "Limmiar" e o link para o
   copiloto.
2. Se `email !== null`, mostra a conta em sessão (`data-testid="conta-sessao"`)
   e o botão "Sair" (chama `onSair`).
3. Sempre monta `<PainelProfissional>` com `accountId`, `accessToken`, `kek`,
   `notas` repassados sem transformação, mais `baseUrl` — que é fixture local
   desta página (`BASE_URL_FIXTURE = ''`), não uma prop. **`sessoes` não é
   repassada desde o S09-02** — o painel carrega-as sozinho.

## Pontos de entrada

- `HomePage({ email, onSair, accountId, accessToken, kek, notas })` —
  componente React. `email`/`onSair` existem desde antes do S09-01; os outros
  quatro chegam da sessão/fixture via `IndexRouteComponent`.
- Montada em `/` via `IndexRouteComponent` (`app/routing/router.tsx`).

## Decisões desta fatia

- **`accessToken`/`kek` continuam `null`, `notas` continua vazia.**
  Mesma situação do resto do router (`NotaRouteComponent`,
  `BibliotecaRouteComponent`): sem `KeychainProvider` ainda, o painel monta
  sempre em "chaveiro bloqueado" em produção — ver
  `widgets/painel-profissional/README.md`.
- **`baseUrl` é fixture local, não prop de `HomePage`.** Mesmo padrão do
  `BASE_URL_FIXTURE` de `pages/notas/NotaPage.tsx`: não entra em nenhuma
  guarda, promovê-lo a prop não muda cobertura nem comportamento enquanto
  `accessToken`/`kek` também são fixture.
- **`sessoes` saiu de `HomePageProps` (S09-02).** O painel passou a carregá-las
  sozinho no seu próprio `useEffect` (mesma guarda kek/conta/token, mesmo
  `cancelled`/`AbortController` já existentes) — ver
  `widgets/painel-profissional/README.md`, "Decisões do S09-02".

## Fora de âmbito

- Sessão/Keychain real (substituir `accessToken`/`kek`/`notas` por valores
  reais no router) — mesma situação, mesmo motivo do `pages/notas/README.md` e
  `pages/biblioteca/README.md`.
- Qualquer decisão do conteúdo do painel (KPIs, fila, ação principal, sessões)
  — vive inteira em `widgets/painel-profissional`, não aqui.
