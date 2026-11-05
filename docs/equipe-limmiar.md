# Equipe Limmiar — mapa, regras e demandas da V1

Criado em 3 de novembro de 2026 pelo MausBot. Este arquivo é a fonte de verdade da
operação da equipe. O Orquestrador Limmiar o mantém atualizado a cada ciclo; os
especialistas leem antes de começar e escrevem aqui apenas estado e evidência, nunca
decisão clínica ou de produto que pertença ao dono.

Escopo vigente: o corte da V1 em `docs/implementacao-final-limmiar.md` (6/10) e
`docs/v1-criterios-de-aceite.md`. Fora da V1: S12 cobrança, S13 medicação, S14
empresarial, S15 desktop, S16 publicação do site, Google/BYOK, notificações da agenda.

## 1. Áreas do projeto

| Área | Onde vive | Estado de partida |
| --- | --- | --- |
| API e dados | `apps/api` (.NET 10, slices verticais, PostgreSQL, RLS, TOTP, auditoria, consentimento) | Fluxos reais; faltam rate limit, HSTS e observabilidade |
| Cliente | `apps/app` (React/Vite, FSD, 4 locales), `apps/site` (Astro), `packages/ui`, `packages/i18n` | Fluxos reais; faltam CSP completa, WCAG 2.2 explícito, teto de bundle; BYOK ainda publicado |
| Transcrição e voz | `apps/gateway-fala`, `packages/audio`, `packages/diarization`, `tools/nemotron`, `tools/voice-identity` | Nemotron 3.5 streaming no servidor (ADR-0012); capacidade e custo por GPU não medidos |
| Copiloto bibliográfico | `mvp-copiloto` (Python), `entities/insight`, `features/live-session/LiveInsights.tsx` | Rota de produto em 503; juiz reprovado na qualificação independente |
| Repositório e entrega | `.gitignore`, árvore Git, `.github/workflows`, `tools/*.mjs`, `fly.toml`, `wrangler.jsonc` | 501 caminhos pendentes: 397 alterações rastreadas (200 exclusões) e 104 não rastreados |
| Decisões do dono | `docs/plano-fechamento-v1.md` §4 | D1 liberação do juiz, D3 texto fora do aparelho, D4 provedor/custo, D5 aprovação CRP, D6 exportação/eliminação |

## 2. Equipe

| Bot | Área exclusiva | Não toca |
| --- | --- | --- |
| Orquestrador Limmiar (chefe) | backlog, sequência, verificação, bloqueios, relatório | implementação de feature |
| Copiloto Limmiar | `mvp-copiloto`, contrato do juiz, avaliação e custo de inferência | API, app, gateway |
| Voz Limmiar | gateway ASR, `packages/audio`, `packages/diarization`, `tools/nemotron`, captura no app | juiz, prontuário, API |
| App Limmiar | `apps/app`, `apps/site`, `packages/ui`, `packages/i18n` | API, `mvp-copiloto`, gateway |
| API Limmiar | `apps/api`, migrations, RLS, segurança, observabilidade | UI, juiz, gateway |
| Repositório e Release Limmiar | Git, `.gitignore`, CI, deploy, segredos, gates | código de produto (abre PR com o dono da área) |

Regra de arquivo: uma onda não coloca dois bots no mesmo arquivo. Mudança de contrato
entre áreas é anunciada ao Orquestrador antes de editar.

## 3. Regras de trabalho (valem para todos)

1. Ler `AGENTS.md`, `ARCHITECTURE.md`, `docs/plano-fechamento-v1.md`,
   `docs/v1-criterios-de-aceite.md` e o README do módulo antes de editar.
2. Sem compatibilidade retroativa: remover o caminho obsoleto em vez de criar camada.
3. Comentário só para o *porquê*; bloco com no máximo 3 linhas (`comments/no-long-comments`).
4. Preferir dependência já instalada e biblioteca mantida a implementação própria.
5. Branch sincronizado com `origin/main`; nunca force-push nem commit direto na `main`.
   Entrega por PR pequeno, um assunto por commit.
6. Nunca commitar segredo, `.local/`, modelo (`.safetensors`, `.onnx`, GGUF) ou áudio.
7. Invariantes de privacidade: áudio nunca persiste (memória apenas); servidor recebe
   só cifras; log não contém fala, query nem identidade; fala de terceiro não vira
   evidência clínica do paciente.
8. Nenhum bot libera o juiz clínico sem qualificação independente; resultado de treino
   ou AUROC não é aprovação.
9. Toda entrega traz o comando rodado, a saída e o caminho da evidência. Número sem
   medição é estimativa e deve ser chamado assim.
10. Decisão de produto, jurídica ou de gasto (D1–D6) sobe ao Orquestrador; ele leva ao dono.

### Comandos de aceite (raiz do repositório)

```powershell
dotnet test apps/api/Api.sln -c Release
pnpm --filter app build
pnpm --filter app lint
pnpm --filter app lint:arch
pnpm --filter app lint:i18n
pnpm --filter app exec vitest run --coverage --maxWorkers=2
pnpm --filter @limmiar/audio test:unit
pnpm --filter @limmiar/diarization test:unit
mvp-copiloto/.venv/Scripts/python.exe mvp-copiloto/scripts/test_confiabilidade.py
```

## 4. Demandas

Legenda: **P0** bloqueia a V1, **P1** fecha a V1, **P2** prova a V1, **P3** depois.
Cada item tem dono único e critério verificável.

### P0 — desbloquear

| # | Demanda | Dono | Critério de conclusão |
| --- | --- | --- | --- |
| R1 | Versionar a V1: inventariar o que está fora do Git, separar por área, ignorar artefatos (`.venv-treino`, `lora`, jsonl grandes, modelos), commitar em fatias e abrir PR | Repositório | `git status --porcelain -- apps packages tools docs mvp-copiloto/src mvp-copiloto/scripts` vazio; nenhum `.venv`, `modelos/` ou `lora/` em `git ls-files`; PR aberto |
| R2 | Linha de base dos gates: rodar todos os comandos de aceite e registrar falhas atuais com log | Repositório | tabela de gate → verde/vermelho → log em `docs/equipe-limmiar.md` |
| A1 | Rate limit por IP e por conta nas rotas sensíveis + HSTS fora de desenvolvimento, 429 em problem+json | API | `dotnet test --filter RateLimit` verde e códigos de problema regenerados |
| A2 | Cabeçalhos do app: `default-src`, `script-src`, `worker-src`, `media-src`, HSTS, `Referrer-Policy`, `Permissions-Policy`, CSP sem origens BYOK | App | `security-headers.test.ts`, build e E2E de `editorial-pages` + `cross-origin-isolation` verdes |
| O1 | Backlog vivo e relatório por ciclo | Orquestrador | este arquivo atualizado com estado, dono e evidência |

### P1 — fechar a V1

| # | Demanda | Dono | Critério de conclusão |
| --- | --- | --- | --- |
| C1 | Juiz: partição por obra (nunca por frase), régua congelada, qualificação independente com precisão, cobertura, Wilson e contraste de fonte | Copiloto | relatório assinado em `mvp-copiloto/resultados/` com números e conjunto sem sobreposição de obra |
| C2 | Copiloto com baixo custo de hardware: comparar modelo local quantizado, triagem em CPU + juiz pequeno e GPU por hora; escolher por precisão medida e custo por sessão | Copiloto | ADR com números medidos e custo por 1.000 falas; decisão registrada |
| C3 | Cartões em dois níveis (forte ≥ 0,99; possível 0,90–0,99), sem `MAX_CARTOES`, `nivel` tipado na tela | Copiloto + App | testes de níveis e de UI verdes, após C1 |
| V1 | Capacidade real por GPU com diarização e custo por hora de stream; ADR de escala, local vs NIM, região São Paulo | Voz | tabela medida (streams/GPU, latência p95) e custo por 1.000 horas de sessão |
| V2 | Gateway: `ack`/reenvio, janela de graça, admissão por capacidade, log sem conteúdo | Voz | queda de 10 s = 0 palavras perdidas; sentinela ausente em todos os logs |
| V3 | Sessão online em duas streams `trilha`, papel pela trilha | Voz + App | teste com duas páginas reais e papéis corretos |
| P1 | Retirar o BYOK; orçamento de bundle; WCAG 2.2 AA explícito | App | `! grep -r copilot-byok apps/app/src`, `check:bundle`, axe com `wcag22aa` |
| P2 | Observabilidade sem texto clínico na API e no copiloto | API | teste que prova ausência de fala no log + métricas de latência e 503 |
| P3 | Atendimento simulado automatizado ponta a ponta (microfone falso, duas vozes) | App | `e2e/atendimento-completo.spec.ts` verde com `pnpm dev` |

### P2 — provar a V1

| # | Demanda | Dono | Critério de conclusão |
| --- | --- | --- | --- |
| D1 | Ambiente de teste web: app, API, Postgres, copiloto e gateway com HTTPS, TURN e CSP reais | Repositório | três `curl` de saúde verdes + roteiro de atendimento executado |
| D2 | Medir WER/DER em voz humana pt-BR (clínica) e em celular intermediário | Voz | documento com WER, DER, RTF p95 e aparelho usado |
| D3 | Votos conforme D3 (só no aparelho ou cifrados com prazo) | Copiloto + API | teste de retenção e de ausência de claro |
| D4 | Exportação e eliminação pelo titular (bloqueada por D6, jurídico) | API + App | roteiro cifrado, com prazo de guarda confirmado por escrito |

## 5. Decisões que sobem ao dono

D1 liberação do juiz, D3 texto do paciente fora do aparelho, D4 provedor e custo do
ambiente de teste, D5 quem aprova o profissional real (CRP), D6 exportação/eliminação
versus guarda do CFP. Nenhum bot decide isso; o Orquestrador leva a pergunta com
recomendação e custo.

## 6. Estado (append-only, mais recente por último)

- 2026-11-03 · MausBot · equipe criada, documento publicado. Partida: 501 caminhos
  pendentes no Git, copiloto em 503, capacidade de ASR não medida.
- 2026-11-03 · Repositório · R1 concluído: os 501 caminhos pendentes foram
  inventariados, classificados e commitados em 8 fatias por área (api, app,
  gateway-fala, tools, docs, ci, mvp-copiloto, tooling de raiz) no branch
  `codex/copiloto-mvp`, sem `git add -A` e sem exclusão de trabalho alheio.
  Verificação: `git status --porcelain -- apps packages tools docs
  mvp-copiloto/src mvp-copiloto/scripts` vazio (exceto este arquivo, commitado
  junto); `git ls-files mvp-copiloto | grep -iE ".venv|modelos/|lora/"` sem
  resultado. Deixados de fora, com motivo: `mvp-copiloto/data/*` (exceto
  `registro.jsonl`, `limiares-juiz-llm.json`, `juiz-pequeno.json`) e
  `modelos/` — dados de treino/rotulagem e pesos, não código-fonte, já
  cobertos pelo `.gitignore`; `.agents/`, `.audit/`, `.codex/` — pastas de
  harness de IA de dono ambíguo, não classificadas com confiança;
  `desligar-em-2-horas.ps1` — utilitário pessoal, não é fonte do projeto.
  PR aberto para `main`: https://github.com/morettto/limmiar/pull/24.
- 2026-11-03 · Repositório · R2 (linha de base dos gates):

  | Gate | Resultado | Evidência |
  | --- | --- | --- |
  | `dotnet test apps/api/Api.sln -c Release` | 🔴 | 408 passed, 531 failed, 939 total. Toda falha é `DockerUnavailableException` (`Failed to connect to Docker endpoint at 'npipe://./pipe/docker_engine'`) na fixture `PostgresContainerFixture`, falhando em ~1 ms — ambiente sem Docker, não regressão de código. |
  | `pnpm --filter app build` | 🟢 | build em 2,59 s; aviso de chunk > 500 kB (`index-*.js`, 623,94 kB), não bloqueante. |
  | `pnpm --filter app lint` | 🟢 | 0 erros; avisos de `react-hooks/exhaustive-deps`, `only-export-components` e `no-this-alias` pré-existentes. |
  | `pnpm --filter app lint:arch` | 🟢 | "no dependency violations found" (396 módulos, 1607 dependências). |
  | `pnpm --filter app lint:i18n` | 🟢 | 0 erros, 5 avisos de `eslint-disable` não usado nos `messages.js` gerados por locale. |
  | `pnpm --filter app exec vitest run --coverage --maxWorkers=2` | 🔴 | 149 arquivos / 1855 testes passaram, mas o teto de cobertura 100% falhou em 11 arquivos (`clinical-vault/crypto.ts`, `ClinicalVaultGate.tsx`, `router.tsx`, `SessionProvider.tsx`, `material/api.ts`, `AcervoPage.tsx`, `AuthScreen.tsx`, `fila-insights.ts`, `LiveInsights.tsx`, `RecoveryPhraseSetup.tsx`, `transcricao-servidor.ts`, `transcrever-online.ts`, `material-capture.ts`, `SessionReview.tsx`, `AtendimentoPage.tsx`); exit code 1. |
  | `pnpm --filter @limmiar/audio test:unit` | 🟢 | 6 arquivos / 59 testes, cobertura 100% em todas as métricas. |
  | `pnpm --filter @limmiar/diarization test:unit` | 🟢 | 3 arquivos / 17 testes, cobertura 100% em todas as métricas. |
  | `mvp-copiloto/.venv/Scripts/python.exe mvp-copiloto/scripts/test_confiabilidade.py` | 🟢 | 11 testes, `OK`, 0,702 s. |

  Gates vermelhos são trabalho alheio (ambiente sem Docker; dívida de
  cobertura pré-existente ao corte da V1) — registrados aqui, não corrigidos
  por este bot.
