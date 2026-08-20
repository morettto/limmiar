# Receipt — S07-01 Cadastro BYOK + envelope da chave + verificação CORS

commit: a3e4d9d
branch: feat/S03-01-modelo-append-only-paciente
spec: S07 Copiloto de IA (BYOK)
rondas_review: 2

## Critério × prova × resultado

| Critério de aceite | Prova | Resultado |
|---|---|---|
| Chave envelopada pela KEK, ausente de qualquer pedido ao nosso servidor | `key-store.ts` sem nenhum `fetch`/import de `../api/client`; DEK fresca por `saveApiKey`, wrap pela KEK via `webcrypto.generateWrappedDek`; AAD (`copilot-crypto.ts`) liga o envelope a `accountId`+`providerId`; por omissão vive só em memória (`inMemoryKey`, módulo-scoped, não sobrevive a reload); persistência em `localStorage` é opt-in ("Lembrar neste dispositivo"), namespaced por `accountId` | PASS |
| Lista de fornecedores suportados verificada por teste automatizado de CORS | `provider-registry.ts` (openai/anthropic/gemini) + `cors-probe.ts` (`credentials: 'omit'`, sem headers de auth) + `apps/app/e2e/copilot-byok.spec.ts` — 4/4 Playwright, 3 probes reais contra os fornecedores + 1 teste de import puro | PASS |
| Registo sem chave não bloqueia o resto do produto | botão "Pular" em `CopilotKeySetup.tsx` chama `onDone()` sem gravar nada, `CopilotKeySetup.test.tsx` cobre o caminho | PASS |

## Pipeline

1. Sessão anterior órfã: código já existia untracked, sem commit/review/receipt, `estado_sessao: running` há 3 dias.
2. `runner` verificou o estado real antes de decidir continuar — typecheck/lint/unit/cobertura/e2e todos verdes.
3. Cadeia de review por ticket: 4 eixos paralelos (linguagem, spec, excesso, segurança) — segurança entrou porque o ticket toca criptografia e chaves.
4. **Ronda 1** corrigiu 4 bloqueantes:
   - Botão Salvar sem desativar com `providerId` vazio (linguagem).
   - Persistência incondicional em localStorage quando a spec pede store não-persistido por omissão com persistência opcional (spec + segurança, mesma causa).
   - Slot de storage global não namespaced por conta (segurança).
   - Formulário com `input[type=password]` acionava o gestor de passwords do browser (segurança).
5. **Ronda 2** focada (lang/spec/segurança) nos ficheiros corrigidos apanhou 1 bloqueante novo: o ramo `!persist` de `saveApiKey` não apagava um envelope já persistido antes — desmarcar "Lembrar" não des-persistia, e o próximo reload ressuscitava a chave antiga. Confirmou que a correção do gestor de passwords (tirar o `<form>`) não bastava porque browsers detetam `input[type=password]` mesmo fora de form — trocado para `type="text"` mascarado via `-webkit-text-security: disc`.
6. Ambos corrigidos, sem ronda 3.

## Cobertura final

271 testes unitários (34 ficheiros), 100% linhas/branches/funções nos ficheiros do ticket; 4/4 e2e Playwright.

## Não-bloqueantes registados (não corrigidos neste ticket)

- (a) `CopilotKeySetup` não está montado em nenhuma rota da app — critério "registo sem chave não bloqueia" fica sem fluxo de produto real onde se prove.
- (b) `clearApiKey(accountId)` sem nenhum chamador — não existe fluxo de logout/sign-out na app ainda para se ligar a ele.
- (c) Falta `Content-Security-Policy`/`connect-src` em `apps/app/public/_headers` e `vite.config.ts` restringindo saída de rede aos domínios dos fornecedores de IA — pré-existente, mas este ticket é o que passa a fazer a app chamar domínios de terceiros com um bearer token.
- (d) `key-store.ts`: `JSON.parse` sobre `localStorage` sem validar forma, decifra falhada propaga erro cru sem `clearApiKey`; `providerId` tipado `string` solto em vez de `AiProvider['id']`; `apiKey` não é limpa do state React após salvar (fica em DevTools se o componente ficar montado).
- (e) `inMemoryKey` é slot único, não mapa — trocar de conta na mesma aba descarta silenciosamente a chave em memória da conta anterior (aceitável para app de conta única, documentar se isso mudar).
- (f) `cors-probe.ts` e `loadApiKey`/`clearApiKey` não têm nenhum chamador de produção ainda (só o próprio módulo e testes) — ficam prontos para o consumidor real que vai chamar o LLM.
- (g) Strings novas do copiloto ("Lembrar neste dispositivo" incluída) por traduzir em en-US/es-419/it-IT (`msgstr ""`), mesmo gap de extração que já existe para `patients/PatientWallet.tsx`.

## Handoff

Ticket S07-01 fechado sem trabalho pendente nele próprio. Segunda spec (S07) ainda tem S07-02 em `A Fazer`/`frontier`. Ronda 2 atingida → `/build:friction` agendado.
