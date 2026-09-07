# pages/home

## Responsabilidade

Monta a tela inicial na rota `/` (`app/routing/router.tsx`, `indexRoute`): mostra a marca,
o link para configurar o copiloto de IA e, quando há sessão ativa, o email da conta e o
botão para sair. Continua um andaime de navegação, não uma landing page real (ver
`ponytail:` no topo de `HomePage.tsx`).

## Fluxo principal

1. `HomePage` lê `useSession()` (`entities/account/session-context.tsx`) diretamente, sem
   receber nada por prop -- `sessao` e `terminarSessao` vêm do contexto.
2. Renderiza sempre `<div id="app-shell">` com o texto "Limmiar" e um
   `<Link to="/settings/copilot">` para a configuração do copiloto.
3. Se `sessao?.email` não for `null`, mostra `<span data-testid="conta-sessao">{email}</span>`
   e um botão "Sair" que chama `terminarSessao` ao clicar.
4. Se `sessao` for `null` (sem sessão), nenhum dos dois aparece -- só a marca e o link.

## Pontos de entrada

- `HomePage()` -- componente React, sem props. Lê a sessão via `useSession()`
  (`entities/account/session-context.tsx`) em vez de receber `email`/`onSair` por parâmetro.
- Montada em `/` via `indexRoute` (`app/routing/router.tsx`), sem route component
  intermédio -- `indexRoute.component = HomePage` diretamente.

## Decisões recentes relevantes

- **`HomePage` deixou de receber `email`/`onSair` como props e passou a ler `useSession()`
  diretamente (S18-10).** Antes, um `IndexRouteComponent` em `app/routing/router.tsx` chamava
  `useSession()` e repassava `sessao?.email ?? null`/`terminarSessao` como props -- existia só
  por causa da regra `fsd-pages-no-app`, que impedia `pages/home` de importar `app`. Com
  `SessionContext`/`useSession()` descidos para `entities/account/session-context.tsx`
  (camada que `pages` já pode importar), o wrapper ficou sem função e foi apagado; `HomePage`
  passou a chamar `useSession()` ela mesma, sem mudar nenhum comportamento observável.
