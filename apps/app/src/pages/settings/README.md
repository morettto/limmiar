# pages/settings

## Responsabilidade

Monta a tela de configuração do copiloto de IA na rota `/settings/copilot`
(`app/routing/router.tsx`, `copilotSettingsRoute`): liga a sessão real e o navegador ao
formulário BYOK de `features/copilot-byok/CopilotKeySetup`.

## Fluxo principal

1. `CopilotKeyPage` lê `useSession()` (`entities/account/session-context.tsx`) diretamente,
   sem receber `accountId` por prop.
2. Renderiza `<CopilotKeySetup accountId={sessao?.id ?? null} kek={null} onDone={onDone} />`.
   `accountId` nunca colapsa para `''` -- `null` sem sessão é o mesmo `null` que
   `CopilotKeySetup` já trata no ramo trancado junto com `kek === null` (ver
   `features/copilot-byok/README.md`).
3. `kek` continua fixo em `null`: não há ainda nenhum `KeychainProvider` montado na app, então
   `CopilotKeySetup` mostra sempre o ramo "Chaveiro bloqueado" com o botão "Pular".
4. `onDone` chama `useNavigate()` para voltar a `/`.

## Pontos de entrada

- `CopilotKeyPage()` -- componente React, sem props. Lê a sessão via `useSession()`
  (`entities/account/session-context.tsx`) em vez de receber `accountId` por parâmetro.
- Montada em `/settings/copilot` via `copilotSettingsRoute` (`app/routing/router.tsx`), sem
  route component intermédio -- `copilotSettingsRoute.component = CopilotKeyPage`
  diretamente.

## Decisões recentes relevantes

- **`CopilotKeyPage` deixou de receber `accountId` como prop e passou a ler `useSession()`
  diretamente (S18-10).** Até então, um `CopilotKeyRouteComponent` em
  `app/routing/router.tsx` chamava `useSession()` e repassava `accountId` como prop (S18-01),
  por causa da regra `fsd-pages-no-app` (`pages` não podia importar `app`). Com
  `SessionContext`/`useSession()` descidos para `entities/account/session-context.tsx`, o
  wrapper deixou de ter função e foi apagado.
- **`accountId` nunca colapsa para `''` (S18-04).** A versão anterior a este ticket já tinha
  corrigido `accountId ?? ''` para manter `string | null` de ponta a ponta, porque `''` é a
  sentinela que `assertAccountId` (`features/copilot-byok/key-store.ts`) rejeita; a leitura
  direta via `useSession().sessao?.id ?? null` introduzida no S18-10 preserva esse mesmo tipo,
  sem reintroduzir a sentinela.
