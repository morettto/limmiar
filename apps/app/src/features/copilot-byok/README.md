# copilot

## Responsabilidade

BYOK (bring your own key) para o copiloto de IA: o profissional cola a própria chave de API de um provedor suportado (OpenAI, Anthropic, Gemini). A chave nunca é enviada ao nosso servidor -- fica só no browser, por omissão apenas em memória (perdida ao recarregar), e opcionalmente envelopada pela KEK e persistida em `localStorage` só quando o profissional marca "Lembrar neste dispositivo" (opt-in, não opt-out).

## Fluxo principal

1. `CopilotKeySetup` (componente) renderiza o formulário -- fornecedor, chave de API, checkbox de persistência -- desde que `kek` não seja `null` (chaveiro desbloqueado; mesmo contrato que `patients/PatientWallet.tsx`). Não é um `<form>`: é uma sequência de `<div>`s com um botão `type="button"`. O campo de chave é `type="text"` (não `"password"`) mascarado só visualmente via CSS (`style={{ WebkitTextSecurity: 'disc' }}`) -- ver Decisões para o porquê de `type="password"` não bastar mesmo fora de um `<form>`.
2. Ao clicar "Salvar" (`handleSave`), chama `saveApiKey(kek, accountId, providerId, apiKey, persist)` de `key-store.ts`. `persist` vem do estado do checkbox, desmarcado por omissão.
3. `key-store.ts` guarda a chave em duas camadas: sempre num `let` módulo-scoped em memória (plaintext, esta aba, perdido ao recarregar); e, só quando `persist` é `true`, também envelopada (DEK fresca por segredo, embrulhada pela KEK, mesmo padrão de `patients/patient-crypto.ts`) em `localStorage`, sob uma chave namespaced por `accountId` (`` `${COPILOT_KEY_STORAGE_KEY}:${accountId}` ``) -- dois profissionais no mesmo dispositivo não se sobrescrevem. Quando `persist` é `false`, `saveApiKey` também remove qualquer envelope já persistido para essa conta antes de retornar -- sem isso, desmarcar "Lembrar" depois de já ter gravado uma vez deixava a chave antiga para sempre em `localStorage`, e um `loadApiKey` após reload (sem cópia em memória) devolvia-a em vez de `null`.
4. `loadApiKey(kek, accountId)` prioriza a cópia em memória (se pertencer a `accountId`, devolve direto, sem decifrar); só cai para `localStorage`/decifra quando a memória está vazia ou é de outra conta -- e, ao decifrar com sucesso, repopula a memória para a leitura seguinte não precisar decifrar de novo.
5. `clearApiKey(accountId)` limpa a cópia em memória (se for da conta) e remove a entrada namespaced de `localStorage`. Não há nenhum fluxo de logout na app ainda que a chame -- fica para um ticket futuro de sessão/auth.
6. `cors-probe.ts` (`probeProviderCors`) faz uma sondagem GET não autenticada para confirmar que o browser consegue mesmo chamar a API do provedor entre origens, antes do profissional confiar a própria chave ao fluxo -- nunca envia a chave, só a sonda.
7. `provider-registry.ts` (`SUPPORTED_PROVIDERS`) é a lista fixa dos 3 provedores suportados no MVP -- array literal, sem registry/factory, porque não cresce em runtime.

## Pontos de entrada

- `CopilotKeySetup` (`CopilotKeySetup.tsx`) -- componente React, props `accountId`, `kek`, `providers?`, `onDone`.
- `saveApiKey`, `loadApiKey`, `clearApiKey`, `COPILOT_KEY_STORAGE_KEY` (`key-store.ts`).
- `copilotDekAad`, `copilotKeyAad` (`copilot-crypto.ts`) -- AAD versionado para o envelope da DEK e da chave, mesma disciplina de `patients/patient-crypto.ts`.
- `probeProviderCors` (`cors-probe.ts`); `SUPPORTED_PROVIDERS`, tipo `AiProvider` (`provider-registry.ts`).

## Decisões relevantes

Persistência é opt-in (checkbox desmarcado por omissão), não opt-out -- a spec S07 pede que a chave "viva em store não persistido, opcionalmente envelopada pela KEK para sobreviver ao reload sem ficar em claro em repouso"; gravar sempre em `localStorage` incondicionalmente violava isso e foi corrigido na ronda 1 de review (bloqueante de spec + segurança).

O storage de `localStorage` é namespaced por `accountId` desde a ronda 1 -- antes disso a chave global (`limmiar:copilot-key`, sem sufixo) fazia a chave de um segundo profissional no mesmo dispositivo sobrescrever silenciosamente a do primeiro.

`e2e/copilot-byok.spec.ts` testa `SUPPORTED_PROVIDERS` contra as APIs reais dos 3 provedores (não fixture local) -- é o único teste do repo que depende de internet real; ver o comentário no topo do próprio spec para como diferenciar uma regressão nossa de uma API/rede fora do ar.

Ronda 2 corrigiu dois bloqueantes que sobraram da ronda 1:
- **Opt-out não apagava o já persistido**: tirar o `<input>` do `<form>` bastava para o botão "Salvar" não disparar submit nativo, mas nada limpava um envelope anterior se o profissional gravasse uma vez com "Lembrar" marcado e depois regravasse (mesma conta) com a caixa desmarcada. `saveApiKey` agora remove a entrada de `localStorage` da conta no ramo `!persist`.
- **`type="password"` continuava a acionar o gestor de senhas mesmo fora de um `<form>`**: Chrome/Firefox/Safari reconhecem `input[type=password]` por si só, independente de haver `<form>`. Trocado para `type="text"` com mascaramento só em CSS (`-webkit-text-security: disc`) e `id`/`name` sem "password"/"senha" para não dar aos heurísticos de autofill nada a que se agarrar. O `value` do DOM continua em claro (é assim que o truque funciona -- mesmo trade-off que `type="password"` teria) e `jsdom` não sabe validar essa propriedade CSS não-padrão no `style` da instância renderizada via Testing Library, por isso o teste de mascaramento usa `react-dom/server`'s `renderToStaticMarkup` para inspecionar a string de atributo `style` que o React de facto gera, em vez do `CSSStyleDeclaration` do jsdom.
