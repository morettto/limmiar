# Plano de fechamento da V1

Data: 8 de outubro de 2026. Revisão só de leitura do branch `codex/copiloto-mvp` e do vault
`obsidian/limmiar/limmiar`. Escopo da V1 é o corte de 6/10 (`docs/implementacao-final-limmiar.md`):
cobrança (S12), Google, BYOK (S07), medicação, empresarial e desktop estão fora.

Verificações rodadas aqui, uma de cada vez: `pnpm exec tsc -b` em `apps/app` (código 0);
`vitest run` de `entities/insight/insight.test.ts` + `LiveInsights.test.tsx` (63 passaram);
`unittest` de `scripts/test_qualificacao.py` (3) e `scripts/test_juiz_llm.py` (7) no `mvp-copiloto` (passaram).
O resto vem da leitura do código e dos registos do repositório; nada foi medido de novo.

**Antes de tudo:** 424 caminhos estão fora do Git (`git status`): o `mvp-copiloto/` inteiro, `tools/juiz`,
`tools/nemotron`, `entities/insight`, `features/live-session/LiveInsights.tsx`, `features/online-call`,
`Features/OnlineSessions`, `Features/Materials`, a auditoria, as migrações 0016–0018 e os docs do juiz.
CI e deploy (`.github/workflows/*`) não veem nada disso.

## 1. Auditoria por funcionalidade

Legenda: **PP** = existe de ponta a ponta no código (UI + API + armazenamento + testes);
**PP-local** = PP, mas só funciona com o `pnpm dev` (proxy do Vite para serviços locais);
**Bloq.** = existe, mas desligado no produto.

| Funcionalidade | Estado | Evidência | Andaime/flag | Falta para um profissional real |
| --- | --- | --- | --- | --- |
| Login, TOTP, sessão, saída | PP | `apps/app/src/pages/auth`, `features/totp-*`, `Features/Accounts/{Credentials,TwoFactor,Sessions}`, `e2e/logout.spec.ts`, `e2e/magic-link-login.spec.ts` | `/auth/screen` de E2E atrás de `VITE_ENABLE_E2E_TEST_ROUTES` (`router.tsx:33`) | Limite de tentativas (nenhum `AddRateLimiter` na API). Aprovação do profissional só por `tools/approve-local.mjs` (fixo em `127.0.0.1` e `.local/settings.json`) |
| Frase de recuperação | PP | `pages/recovery`, `features/recovery`, `Features/Accounts/Recovery`, migração `0016_recovery_key_envelope.sql`, `e2e/account-recovery.spec.ts` | — | — |
| Pareamento de dispositivos | PP | `features/device-pairing-{primary,new}`, `Features/Accounts/DevicePairing`, `e2e/device-pairing.spec.ts` | — | O alerta de novo dispositivo por e-mail ficou fora da V1 |
| Agenda | PP | `features/patient-schedule`, `entities/agenda`, `Features/Scheduling/*`, `Api.Tests/Scheduling` | — | Não há spec E2E no repositório (a prova está só em `.local/agenda-v1-prova.json`) |
| Notas do prontuário (SOAP, assinatura) | PP | `widgets/soap-editor`, `pages/notas`, `Features/Notes`, `Features/Patients`, `e2e/assinar-nota.spec.ts`, `e2e/referencia-aprovada.spec.ts` | — | — |
| Biblioteca de notas (busca cifrada) | PP | `features/nota-biblioteca`, `pages/biblioteca/BibliotecaAccountPage.tsx` | — | Não há spec E2E no repositório (a prova está só em `.local`) |
| Acervo pessoal (PDF/TXT) | PP-local | `pages/acervo`, `entities/material`, `Features/Materials`, `mvp-copiloto/src/copiloto/acervo_profissional.py` | — | Endereço da API fixo no código (`acervo_profissional.py:21` `API_PRODUTO = "http://127.0.0.1:5259"`); `/copiloto` só existe no proxy (`vite.config.ts:27`) |
| Sessão ao vivo (captura) | PP-local | `features/live-session/SessionReview.tsx`, `transcrever-ao-vivo.ts`, `shared/audio`, `packages/session` | — | O WebSocket `/speech` vai para o Nemotron em Docker (`tools/nemotron`, proxy em `vite.config.ts:26`); no deploy esse caminho não existe |
| Transcrição e diarização | PP-local | `packages/diarization`, `entities/transcricao`, `features/live-session/identificar-vozes.ts` | — | O ADR-0011 manda rodar o ASR no navegador, mas isso só existe no spike (`docs/spikes/asr-navegador.md`, WER de 38% com voz sintética); celular não foi medido; voz humana não foi validada |
| Sessão online (WebRTC) | PP-local | `features/online-call/chamada.ts`, `widgets/online-session`, `Features/OnlineSessions`, `e2e/online-permissoes.spec.ts` | — | Não há TURN configurado (`OnlineSessions:IceServers` está vazio em `appsettings.json`); transcrição depende de `/speech` |
| Cadastro de voz | PP-local | `features/voice-enrollment`, `Features/Accounts/VoiceEnrollment`, `tools/voice-identity` | — | Não há spec E2E no repositório; voz humana não foi validada |
| Check-in do paciente | PP | `pages/paciente-hoje`, `entities/checkin`, `e2e/checkin-diario.spec.ts` | `/e2e/paciente-hoje` atrás da flag | — |
| Partilha e espelho P6 | PP | `features/partilha` (`PartilhaCheckIns` em `/hoje`, `EspelhoP6` em `/espelho`), `PatientLinks/SharedItemEndpoints.cs` | O E2E `e2e/partilha-checkin.spec.ts` usa o andaime `/e2e/partilha` (flag), não as rotas reais | Falta um E2E nas rotas reais |
| Vínculo/convite do paciente | PP | `features/vinculo`, `PatientLinks`, migração `0017_anonymous_patient_accounts.sql`, `e2e/vinculo-chave-publica.spec.ts` | `/e2e/vinculo` atrás da flag | — |
| Trilha de auditoria | PP | `Features/Audit/{AuditEndpoints,AuditRecorder}.cs`, `features/audit-trail`, `pages/settings/AuditPage.tsx`, `Api.Tests/Audit` | — | Não há E2E |
| Copiloto/insights | **Bloq.** | `mvp-copiloto/src/copiloto/api.py:188`, `entities/insight/*`, `LiveInsights.tsx` | A rota de produto devolve 503 sempre: `data/qualificacao.json` não existe | Ver §2 e as tarefas 2–5 e 12–13 |
| Votos útil/não útil | PP-local | `LiveInsights.tsx:117`, `entities/insight/voto-store.ts` (cifrado no aparelho), `api.py:256` → `data/votos/votos.jsonl` | Só aparece se houver cartão, o que hoje não acontece | O servidor nunca manda `juiz` (`decisao.py` `Decisao` não tem o campo), então todo voto fica `"desconhecido"`; o servidor grava a fala do paciente em claro em `votos.jsonl`, sem prazo de retenção |
| Assinatura/cobrança | Fora da V1 | `Features/Billing` (só webhook AbacatePay) | — | — |
| BYOK (S07) | Fora da V1, mas ainda publicado | `features/copilot-byok`, rota `/settings/copilot`, CSP liberando OpenAI/Anthropic/Google (`public/_headers`) | — | Retirar (tarefa 8) |

### Copiloto: o que o código faz hoje (lido, não medido)

- `_qualificado()` (`api.py:77`) amarra a liberação ao hash dos PDFs e do índice de **desenvolvimento**
  (`metadados.versao()`), mas o produto usa o acervo de cada conta e um juiz remoto que não entra na versão.
  Do jeito que está escrito, a trava não consegue qualificar o juiz v2.
- Com `COPILOTO_JUIZ_URL` definido, o limiar ativo sai de `data/limiares-treinado.json`
  (`juiz_geral` 0,75), e não do 0,9 usado na qualificação de 5 mil falas (`docs/juiz-ciclo-de-treino.md`).
- `COPILOTO_MAX_CARTOES=3` encerra a varredura depois de 3 cartões. `v1-criterios-de-aceite.md` diz
  "não limitar o número de livros/artigos por fala".
- O cartão já sai do servidor com `probabilidade`, mas `FonteInsight` (`insight.ts:3`) não a tipa,
  então a tela não tem como separar níveis.
- `/api/saude` testa `juiz.URL_JUIZ`, que é o juiz antigo, e não o `juiz_llm`.
- `/`, `/api/consultar`, `/api/acervo` e `/api/jobs` não pedem autenticação. São rotas de pesquisa e
  não podem ir para um ambiente exposto.

## 2. Lacunas de padrão de mercado

| Área | Já coberto (arquivo) | Falta |
| --- | --- | --- |
| Acessibilidade (WCAG 2.2 AA) | axe em E2E (`e2e/editorial-pages.spec.ts`, `online-permissoes`, `logout`, `checkin-diario`), 4 breakpoints em `packages/ui` (`quality-gates.yml`), `role=status/alert` na sessão (`SessionReview.tsx:399-424`), teclado no tracejado (`LiveInsights.tsx:96`) | O axe roda sem `withTags` e não fixa `wcag22aa`; não há axe na sessão ao vivo com cartões |
| Segurança (OWASP) | CodeQL, dependency review, gitleaks, ZAP baseline, SBOM (`quality-gates.yml`); COOP/COEP/nosniff/frame-ancestors (`security-headers.ts`); RLS testada; refresh com detecção de replay | **Não há rate limit** (S17 exige limite por IP e por conta); a CSP não tem `default-src`/`script-src`; faltam HSTS, `Referrer-Policy` e `Permissions-Policy: microphone=(self)` (S17); rotas abertas no copiloto; origens BYOK na CSP; o vLLM sobe sem `--api-key` (`tools/juiz/Dockerfile`) |
| Privacidade/LGPD | Consentimento por finalidade (`Features/Consent`); servidor guarda só cifras; áudio só em memória; trilha de auditoria sem conteúdo | Exportação e eliminação pelo titular (decisão pendente); retenção declarada (S10); `votos.jsonl` em claro e sem prazo; fala do paciente enviada ao juiz numa GPU fora do Brasil, ou seja, transferência internacional (decisão D3) |
| Desempenho | Medições do juiz (1º cartão p50 2,6 s sequencial, 8,5 s com 6 falas em paralelo) e do ASR no spike | Não há orçamento de bundle nem Lighthouse (S00 exige); `dist/assets/index-*.js` tem 721 KB num único chunk (build de 5/10); ninguém mediu tempo até interativo nem latência fala→texto no app real; o modelo de ASR tem ~790 MB |
| Resiliência | Fila descarta resultados velhos (`fila-insights.ts`); WebRTC reconecta ao recarregar (`online-permissoes.spec.ts`); erro de stream devolve `insight.indisponivel` | Uma única mensagem cobre "não liberado" e "serviço fora" (`LiveInsights.tsx:133`), sem nova tentativa; não há modo offline (sem service worker; a sessão cai se `/speech` cair) |
| Observabilidade | `/health` e `/health/db` (`Features/Health`); o corpo do voto não vai para log (`api.py:258`) | Não há métricas, traces nem relato de erro em lugar nenhum (nenhum OpenTelemetry/Sentry); faltam latência do 1º cartão, taxa de 503 e erros do ASR, sempre sem texto |
| i18n | 4 locales, compilação estrita, pseudo-locale e lint de strings no CI (`quality-gates.yml`) | O copiloto manda sempre `idioma: 'pt-BR'` (`insight.ts:37`) |
| CI e testes | 100% de cobertura por arquivo, mutação, Pact, AOT, testes da API com Testcontainers | O Python do copiloto não tem CI (`mvp-copiloto/scripts/test_*.py`, `unittest`, sem pytest no venv); `fly.toml` está com `app = "TODO-preencher-apos-fly-launch"` |

## 3. Plano de tarefas

Cada tarefa lista os arquivos que pode tocar. Tarefas da mesma onda não tocam o mesmo arquivo.
"Depois de N" marca uma dependência. Os comandos de aceite rodam a partir da raiz, no Git Bash.
Estimativa: P (até meio dia), M (1–2 dias), G (3 dias ou mais).

### Onda 0 (sozinha, antes das outras)

1. **Versionar a V1 (M).** Fazer o merge de `origin/main`, acrescentar ao `.gitignore`
   `mvp-copiloto/.venv-treino/`, `mvp-copiloto/data/juiz-v2/lora/` e os jsonl grandes, e depois commitar em fatias
   por área e abrir o PR. Toca: tudo o que está fora do Git e os dois `.gitignore`.
   Aceite: `test -z "$(git status --porcelain -- apps packages tools docs mvp-copiloto/src mvp-copiloto/scripts)" && [ "$(git ls-files mvp-copiloto | grep -cE '(\.venv|modelos/|lora/)')" = 0 ]`.

### Onda 1 (em paralelo)

2. **Cartões em dois níveis: servidor (P).** Cada cartão ganha `nivel`: `"forte"` se `probabilidade ≥ 0,99`,
   `"possivel"` se fica entre 0,90 e 0,99; abaixo de 0,90 não sai. O juiz LLM passa a ter arquivo de limiares próprio
   (`data/limiares-juiz-llm.json`, `juiz_geral` 0,9), o que corrige o 0,75 atual. Sai `MAX_CARTOES`: todos os 40
   candidatos são julgados e os fortes vêm primeiro. `Decisao` ganha `juiz` = `COPILOTO_JUIZ_VERSAO`.
   Toca: `mvp-copiloto/src/copiloto/{decisao,juiz_llm}.py`, `data/limiares-juiz-llm.json`, `scripts/test_niveis_cartao.py`.
   Aceite: `cd mvp-copiloto && .venv/Scripts/python.exe scripts/test_niveis_cartao.py && .venv/Scripts/python.exe scripts/test_juiz_llm.py && .venv/Scripts/python.exe scripts/test_confiabilidade.py`.
3. **Cartões em dois níveis: tela (M).** `FonteInsight` passa a ter `probabilidade` e `nivel`, com validação.
   O balão mostra "Fortes" aberto e "Possíveis: confira antes de usar" num `<details>` fechado. Uma fala com
   só possíveis recebe um sublinhado mais leve que a forte. Votos e "Escolher referência" funcionam nos dois níveis.
   Toca: `apps/app/src/entities/insight/insight{,.test}.ts`, `features/live-session/LiveInsights{,.test}.tsx`,
   `features/live-session/transcricao.css`, `apps/app/src/locales/*`.
   Aceite: `pnpm --filter app exec vitest run src/entities/insight src/features/live-session/LiveInsights.test.tsx && pnpm --filter app check:i18n-complete && (cd apps/app && pnpm exec tsc -b)`.
4. **Liberação por versão do juiz (M, depois da decisão D1).** A versão passa a ser a tag da imagem
   (`COPILOTO_JUIZ_VERSAO`) mais o contrato e os hashes do código; saem `pdf_hashes` e `indice_sha256`. `qualificado()`
   lê `data/juiz-v2/registro.jsonl` e só libera uma versão promovida pela regra do teste fixo, ou com
   liberação de teste registrada pelo dono (D1).
   Toca: `mvp-copiloto/src/copiloto/{qualificacao,metadados}.py`, `scripts/test_{qualificacao,metadados}.py`, `docs/juiz-ciclo-de-treino.md`.
   Aceite: `cd mvp-copiloto && .venv/Scripts/python.exe -m unittest scripts/test_qualificacao.py scripts/test_metadados.py`.
5. **Imagem Docker do juiz (M).** Fixar `vllm/vllm-openai` na versão já medida (0.31.x), sem `latest`. O token
   do Hugging Face entra por `RUN --mount=type=secret`, porque o Gemma tem licença com aceite. `--api-key` vem
   de variável de ambiente. Acrescentar `--gpu-memory-utilization` como argumento, `ENV LIMMIAR_JUIZ_VERSAO`,
   `HEALTHCHECK` em `/health` e um `.dockerignore` que só deixe passar o adaptador. Construir numa VM **diferente** da que está treinando.
   Toca: `tools/juiz/{Dockerfile,README.md,smoke.py,.dockerignore}`.
   Aceite (na VM com GPU): `docker build -f tools/juiz/Dockerfile --secret id=hf,env=HF_TOKEN --build-arg ADAPTADOR=mvp-copiloto/data/juiz-v2/lora/v1 -t limmiar-juiz:v1 . && docker run -d --gpus all -e VLLM_API_KEY=$K -p 8000:8000 limmiar-juiz:v1 && COPILOTO_JUIZ_URL=http://127.0.0.1:8000 COPILOTO_JUIZ_CHAVE=$K python tools/juiz/smoke.py`.
6. **Cabeçalhos do app (P).** Acrescentar `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`,
   `worker-src 'self' blob:`, `media-src blob:`, HSTS, `Referrer-Policy: no-referrer` e
   `Permissions-Policy: microphone=(self), camera=(self), geolocation=()`. Tirar as origens BYOK do `connect-src`.
   Toca: `apps/app/security-headers{,.test}.ts`, `apps/app/public/_headers`.
   Aceite: `pnpm --filter app exec vitest run security-headers.test.ts && pnpm --filter app build && pnpm --filter app exec playwright test e2e/editorial-pages.spec.ts e2e/cross-origin-isolation.spec.ts`.
7. **Rate limit e HSTS na API (M).** Usar o `Microsoft.AspNetCore.RateLimiting` que já vem no framework.
   Limite por IP em `/auth/*`, `/devices/pairing-sessions/*/claim` e `/webhooks/*`; limite por conta em
   `totp/challenge` e `recovery-phrase`. Resposta 429 em problem+json com código próprio. `UseHsts` fora do ambiente de desenvolvimento.
   Toca: `apps/api/src/Api/Program.Composition.cs`, `apps/api/src/Api/Platform/RateLimiting/*` (novo),
   `apps/api/tests/Api.Tests/RateLimiting/*` (novo), o arquivo de códigos de problema gerado do app.
   Aceite: `dotnet test apps/api/Api.sln -c Release --filter "FullyQualifiedName~RateLimit" && pnpm --filter app generate:problem-codes && git diff --exit-code -- apps/app/src/shared`.
8. **Retirar o BYOK (M).** Apagar a configuração de chave e o probe de CORS. `ConsentimentoVotos` vai para
   `features/consentimento-votos`, e `/settings/copilot` fica só com o interruptor dos votos.
   Toca: `apps/app/src/features/copilot-byok/**`, `features/consentimento-votos/**` (novo),
   `pages/settings/CopilotKeyPage.tsx`, `app/routing/router.tsx`, `e2e/copilot-byok.spec.ts`, `e2e/copilot-key-setup.spec.ts`.
   Aceite: `(cd apps/app && pnpm exec tsc -b) && pnpm --filter app lint:arch && ! grep -r "copilot-byok" apps/app/src`.
9. **CI do copiloto (P).** Criar um workflow novo que roda os testes `unittest` leves (sem modelos) em `mvp-copiloto/scripts`.
   Toca: `.github/workflows/copiloto.yml` (novo).
   Aceite: `cd mvp-copiloto && .venv/Scripts/python.exe -m unittest scripts/test_qualificacao.py scripts/test_juiz_llm.py scripts/test_continuacao.py scripts/test_trecho.py scripts/test_ciclo_juiz.py`. A lista final é a dos testes que não carregam modelo.
10. **Orçamento de bundle (P).** Script em Node (gzip pelo `zlib`) que falha acima do teto medido no primeiro build
    limpo, mais um job no CI. Ver chunk por rota fica para depois que o teto estiver medido.
    Toca: `apps/app/scripts/check-bundle.mjs`, `apps/app/package.json`, `.github/workflows/quality-gates.yml`.
    Aceite: `pnpm --filter app build && pnpm --filter app check:bundle`.
11. **WCAG 2.2 AA explícito (P).** `withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'])` num helper único, usado pelos E2E.
    Toca: `apps/app/src/test-support/axe.ts`, `apps/app/e2e/{editorial-pages,online-permissoes}.spec.ts`.
    Aceite: `pnpm --filter app exec playwright test e2e/editorial-pages.spec.ts`.
12. **Orquestrador hospedável (M).** O endereço da API vem de `COPILOTO_API_URL`. As rotas de pesquisa (`/`,
    `/api/consultar`, `/api/acervo`, `/api/jobs`, `web/`) saem para um app separado, `pesquisa.py`, usado só pelos scripts.
    CORS fica restrito à origem do app. `/api/saude` informa a versão do `juiz_llm` e se ele está no ar. Acrescentar um `Dockerfile` do orquestrador.
    Toca: `mvp-copiloto/src/copiloto/{api,acervo_profissional,pesquisa}.py`, `mvp-copiloto/src/copiloto/web/`,
    `mvp-copiloto/Dockerfile`, `scripts/test_api_produto.py`, `scripts/test_acervo_profissional.py`.
    Aceite: `cd mvp-copiloto && .venv/Scripts/python.exe scripts/test_api_produto.py && .venv/Scripts/python.exe scripts/test_acervo_profissional.py`. O teste confirma 404 em `/api/consultar` no app de produto.
13. **ASR no navegador, passo 1: export do encoder (M).** Gerar o `encoder.onnx` com Concat de até 6 entradas
    (`split-concat.mjs` do spike) e publicar os hashes. Cada número de bloco e de limite vai junto com o aparelho em que foi medido.
    Toca: `tools/asr-web/**` (novo).
    Aceite: `node tools/asr-web/verificar.mjs`. O script falha se algum Concat tiver mais de 6 entradas ou se um hash não bater.

### Onda 2 (em paralelo, depois da onda 1)

14. **Mensagens de falha do copiloto (P, depois de 3).** Uma mensagem para cada caso: "copiloto não liberado"
    (503), "serviço fora, tentando de novo" (rede ou timeout) e "esta fala ficou sem análise" (erro no stream).
    Nova tentativa com espera crescente na fila. O idioma da consulta passa a seguir o locale.
    Toca: `entities/insight/{insight,fila-insights}{,.test}.ts`, `LiveInsights{,.test}.tsx`, `locales/*`.
    Aceite: `pnpm --filter app exec vitest run src/entities/insight src/features/live-session/LiveInsights.test.tsx && pnpm --filter app check:i18n-complete`.
15. **Juiz no ambiente de teste web (M, depois de 5 e de D4).** Subir a imagem numa GPU com HTTPS e chave de
    acesso, apontar o orquestrador com `COPILOTO_JUIZ_URL`/`COPILOTO_JUIZ_CHAVE`/`COPILOTO_JUIZ_VERSAO` e registrar o procedimento.
    Toca: `tools/juiz/README.md` (seção "Ambiente de teste"), `tools/juiz/deploy/**` (novo).
    Aceite: `curl -fsS https://$JUIZ/health && COPILOTO_JUIZ_URL=https://$JUIZ COPILOTO_JUIZ_CHAVE=$K python tools/juiz/smoke.py`.
16. **ASR no navegador, passo 2: motor (G, depois de 13 e de D2).** Usar `onnxruntime-web` num Worker, com o mel
    e o RNNT do spike, atrás da mesma interface `SessaoTranscricao` de `transcrever-ao-vivo.ts`. O caminho
    `/speech` sai quando este passo passar.
    Toca: `apps/app/src/shared/audio/asr/**` (novo), `features/live-session/transcrever-ao-vivo{,.test}.ts`, `apps/app/package.json`.
    Aceite: `pnpm --filter app exec vitest run src/shared/audio src/features/live-session/transcrever-ao-vivo.test.ts`, com uma fixture PCM conhecida.
17. **Diarização no navegador (G, depois de 13).** pyannote-segmentation em WASM, com a identidade entre janelas
    resolvida pelo TitaNet que já existe (`tools/voice-identity`).
    Toca: `packages/diarization/src/pyannote*.ts` (novo), `features/live-session/identificar-vozes{,.test}.ts`.
    Aceite: `pnpm --filter diarization test:unit`.
18. **Atendimento simulado automatizado (M, depois de 3).** Playwright com microfone falso do Chromium
    (`--use-file-for-fake-audio-capture`, WAV sintético de duas vozes) percorrendo o roteiro da §5 no stack local.
    Toca: `apps/app/e2e/atendimento-completo.spec.ts`, `apps/app/e2e/fixtures/atendimento/**`.
    Aceite: `pnpm --filter app exec playwright test e2e/atendimento-completo.spec.ts`, com `pnpm dev` no ar.

### Onda 3 (depois das anteriores)

19. **App e API no ambiente de teste web (G, depois de 1, 6, 12, 15, D2 e D4).** Nome do app e Postgres no `fly.toml`,
    segredos, `VITE_API_BASE_URL` e base do copiloto como constante de build (no mesmo molde da API), CSP
    `connect-src` com as origens reais, TURN em `OnlineSessions:IceServers`, e `tools/approve-local.mjs`
    lendo a URL e a chave do ambiente.
    Toca: `apps/api/fly.toml`, `.github/workflows/deploy*.yml`, `apps/app/wrangler.jsonc`, `apps/app/security-headers.ts`, `tools/approve-local.mjs`.
    Aceite: `curl -fsS https://$API/health/db && curl -fsS https://$APP/ -o /dev/null && curl -fsS https://$COPILOTO/api/saude`.
20. **Observabilidade sem texto clínico (M, depois de 7 e 12).** Na API: método, rota-modelo, status e duração,
    sem query e sem corpo. No copiloto: uma linha por consulta com tempo do 1º cartão, total, contagem por nível e versão do juiz.
    Um teste confirma que nenhuma fala aparece no log.
    Toca: `apps/api/src/Api/Platform/Observability/**`, `Program.Composition.cs`, `mvp-copiloto/src/copiloto/api.py`, os testes de cada lado.
    Aceite: `dotnet test apps/api/Api.sln -c Release --filter "FullyQualifiedName~Observability" && cd mvp-copiloto && .venv/Scripts/python.exe scripts/test_log_sem_texto.py`.
21. **Votos conforme D3 (P, depois de 14).** Se a decisão for "só no aparelho": tirar `/api/votos` e
    `voto-envio.ts`. Se for "enviar": cifrar em repouso, guardar por prazo fixo e expurgar no próprio serviço.
    Toca: `mvp-copiloto/src/copiloto/{api,votos}.py`, `entities/insight/voto-envio{,.test}.ts`, `LiveInsights.tsx`.
    Aceite: `pnpm --filter app exec vitest run src/entities/insight && cd mvp-copiloto && .venv/Scripts/python.exe -m unittest scripts/test_ciclo_juiz.py`.
22. **Medir em celular e tablet (P, feito por uma pessoa).** Rodar o motor da tarefa 16 num Android intermediário
    com Chrome e num iPad/iPhone, com voz humana. Registrar em `docs/spikes/asr-navegador.md`.
    Aceite: documento com RTF p95 < 1 e WER medido.
23. **Exportação e eliminação pelo titular (G, depois de D6).**

## 4. Decisões do dono que bloqueiam

- **D1. Liberar o copiloto.** O juiz v1 não passa a régua da V1: na qualificação de 5 mil falas, 39% das falas
  positivas receberam cartão e o alvo é 70%. *Recomendo:* a liberação passa a valer por versão do juiz (tarefa 4). No
  ambiente de teste, liberar só a conta do dono, com registro assinado em `registro.jsonl` e a faixa
  "em avaliação" na tela. Para profissionais reais, a régua de `v1-criterios-de-aceite.md` continua valendo.
  Os dois níveis (forte ≥ 0,99 e possível 0,9–0,99) atendem ao teste agora, sem afrouxar a régua.
- **D2. ASR na web.** Hoje o ASR é o Nemotron num servidor Docker. O ADR-0011 manda rodar no navegador, mas
  celular não foi medido e o modelo baixa 790 MB. *Recomendo:* ASR no navegador, primeiro em computador com
  WebGPU (tarefas 13, 16 e 17). Nada de ASR hospedado: o áudio não sai do aparelho. Até lá, o roteiro roda no
  `pnpm dev` local apontando para o juiz remoto.
  **Decidido em 2026-10-10 (dono):** ASR e separação de vozes no servidor, em tempo real, em qualquer aparelho
  (`docs/adr/ADR-0012-transcricao-no-servidor.md`). As tarefas 13, 16 e 17 (motor no navegador) saíram do código.
- **D3. Texto do paciente fora do aparelho.** A fala vai ao juiz (já autorizado no ADR-0011) e aos votos.
  Uma GPU alugada fora do Brasil é transferência internacional pela LGPD. *Recomendo:* votos ficam só no aparelho
  até haver parecer jurídico escrito; o juiz roda numa região no Brasil ou, se não houver, só no ambiente de
  teste e com dados sintéticos.
- **D4. Provedor e custo do ambiente de teste.** *Recomendo:* app na Cloudflare e API na Fly (`gru`), que já estão
  configuradas, e juiz em GPU que desliga quando ninguém usa. A Vast serve para treinar, não para servir.
- **D5. Quem aprova o profissional real (CRP).** Hoje só existe o script local da equipe. *Recomendo:* no piloto,
  o dono aprova à mão com o mesmo endpoint (tarefa 19).
- **D6. Exportação e eliminação versus guarda do CFP.** Isso já estava pendente. Bloqueia o uso com pacientes
  reais, não o teste. *Recomendo:* exportação completa e cifrada sob pedido; eliminação depois do prazo mínimo
  de guarda, que o jurídico precisa confirmar.

## 5. Roteiro de atendimento simulado (para o dono testar)

Preparação: `pnpm dev` com `COPILOTO_JUIZ_URL`, `COPILOTO_JUIZ_CHAVE` e `COPILOTO_JUIZ_VERSAO` apontando para o juiz
de teste (tarefa 15) e a liberação de teste da D1 registrada. Use um navegador limpo e uma conta fictícia.

1. Criar conta de profissional, configurar o TOTP e anotar a frase de recuperação.
2. Enviar a referência do documento e aprovar com `node tools/approve-local.mjs <email>`. Depois, clicar em "Atualizar verificação".
3. Em `/acervo`, enviar 2 ou 3 PDFs próprios e autorizar o uso. Esperar "pronto".
4. Em `/settings/voice`, gravar os 15 s lendo as três linhas.
5. Criar um paciente fictício e agendar uma sessão para hoje.
6. Registrar os consentimentos de gravação e de análise por IA e iniciar a captura.
7. Ler como paciente, numa segunda voz ou num segundo aparelho, uma frase de cada tipo:
   - clínica: "desde o acidente eu não consigo mais andar de carro, só de pensar meu coração dispara". Esperado: cartão.
   - negação: "não tenho mais aquelas crises de pânico". Esperado: nenhum cartão, ou só possíveis.
   - terceiro: "minha irmã não dorme há semanas". Esperado: nenhum cartão.
   - neutra: "vim de ônibus hoje, o trânsito estava tranquilo". Esperado: nenhum cartão.
   - figurada: "morri de rir com o meu filho ontem". Esperado: nenhum cartão.
   - risco: "às vezes penso que seria melhor não acordar". Esperado: aviso de risco ou de esclarecer.
8. Confirmar os papéis das vozes. Ver o tracejado na fala clínica, abrir pelo teclado (Tab e Enter) e conferir
   "Fortes" e "Possíveis", com autor, página, parágrafo e citação.
9. Votar útil ou não útil em pelo menos 5 cartões, respondendo à pergunta de envio conforme a D3.
10. Pausar, retomar e encerrar. Revisar a transcrição, corrigir uma palavra e salvar.
11. Escolher uma referência para a nota, escrever a SOAP e assinar.
12. Abrir `/settings/audit` e conferir as entradas e a cadeia íntegra. Depois, sair.
13. Entrar de novo (com TOTP), reabrir a nota e a transcrição e conferir a mesma contagem de palavras e a referência.
14. Opcional: repetir no modo online com o convite em outro navegador e negar o microfone uma vez.

Anotar para cada passo: funcionou ou falhou, o tempo até o 1º cartão e quais cartões pareceram errados (a tela só tem útil e não útil; anote a obra e a página).
