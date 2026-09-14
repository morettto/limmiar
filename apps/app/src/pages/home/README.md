# pages/home

## Responsabilidade

Casca de navegação montada na rota `/` (`app/routing/router.tsx`). Continua fina de
propósito, um andaime de navegação e não uma landing page real (ver `ponytail:` no topo de
`HomePage.tsx`): a marca, o link para `/settings/copilot`, a conta em sessão + botão "Sair"
quando há sessão ativa, e a montagem do painel profissional
(`widgets/painel-profissional/PainelProfissional.tsx`), repassando direto as props que recebe.
Não decide nada do painel; só o conecta.

## Fluxo principal

1. `HomePage` lê `useSession()` (`entities/account/session-context.tsx`) diretamente --
   `sessao` e `terminarSessao` vêm do contexto, não de props.
2. Renderiza sempre `<div id="app-shell">` com "Limmiar" e o `<Link to="/settings/copilot">`.
3. Se `sessao?.email` não for `null`, mostra `<span data-testid="conta-sessao">{email}</span>`
   e o botão "Sair", que chama `terminarSessao`. Sem sessão, nenhum dos dois aparece.
4. Sempre monta `<PainelProfissional>` com `chaveiro`/`notas` repassados sem transformação,
   mais `baseUrl` -- fixture local desta página (`BASE_URL_FIXTURE = ''`), não uma prop.

## Pontos de entrada

- `HomePage({ chaveiro, notas })` -- componente React. `chaveiro: { kek, accountId,
  accessToken } | null` chega já montado de `IndexRouteComponent` (`app/routing/router.tsx`);
  `null` = chaveiro trancado.
- Montada em `/` via `IndexRouteComponent` (`app/routing/router.tsx`).

## Decisões relevantes

- **`HomePage` lê `useSession()` diretamente, sem `email`/`onSair` por prop (S18-10).** O
  wrapper antigo existia só por causa de `fsd-pages-no-app`; com `useSession()` descido para
  `entities/account/session-context.tsx`, deixou de ser preciso para a sessão.
  `IndexRouteComponent` voltou no S09 só para fixar `chaveiro`/`notas`.
- **`chaveiro` continua `null` em produção, `notas` continua vazia.** Mesma situação do resto
  do router (`NotaRouteComponent`, `BibliotecaRouteComponent`): sem `KeychainProvider` ainda,
  o painel monta sempre em "chaveiro bloqueado" em produção -- ver
  `widgets/painel-profissional/README.md`.
- **`baseUrl` é fixture local, não prop de `HomePage`.** Mesmo padrão do `BASE_URL_FIXTURE` de
  `pages/notas/NotaPage.tsx`: não entra em nenhuma guarda, promovê-lo a prop não muda cobertura
  nem comportamento enquanto `chaveiro` também é fixture.

## Fora de âmbito

- Keychain real (substituir `chaveiro`/`notas` por valores reais no router) -- mesma situação,
  mesmo motivo do `pages/notas/README.md` e `pages/biblioteca/README.md`.
- Qualquer decisão do conteúdo do painel (KPIs, fila, ação principal, sessões) -- vive inteira
  em `widgets/painel-profissional`, não aqui.
