# Ambiente de teste web

Decisão D4 de `docs/plano-fechamento-v1.md` (tarefas 15 e 19): app na Cloudflare, API e orquestrador do copiloto na Fly
(região `gru`), juiz numa GPU da Fly que para sozinha quando ninguém usa. Os arquivos estão prontos no repositório; **nada foi
publicado nem criado**. Tudo marcado **[VOCÊ]** exige uma conta, um segredo ou um clique seu.

```
navegador ──► app (Cloudflare Workers, limmiar-app)
   │  VITE_API_BASE_URL            VITE_COPILOTO_BASE_URL
   ├──► API .NET (Fly gru, limmiar-api-teste) ──► Postgres
   └──► orquestrador (Fly gru, limmiar-copiloto-teste) ──► API (autoriza cada operação)
                                        └──► juiz (Fly GPU, limmiar-juiz-teste)
```

A transcrição roda num serviço à parte (`tools/nemotron`, ADR-0012): o app hospedado abre um WebSocket para a origem em
`VITE_SPEECH_BASE_URL` (liberada em `connect-src` com o par `wss:`). **Esse serviço ainda não tem hospedagem**: ele precisa de TLS,
chave de API e, para acompanhar o tempo real com separação de vozes, GPU. Sem ele o build hospedado não transcreve.
O app hospedado cobre: conta, TOTP, aprovação, acervo, voz, agenda, sessão online, transcrição (pelo serviço) e o painel.

## Nomes (trocáveis)

Nome de app Fly é global e o do Worker é por conta. Se algum estiver tomado, troque no arquivo e aqui.

| Peça | Nome | Arquivo |
|---|---|---|
| API | `limmiar-api-teste` | `apps/api/fly.toml` |
| Orquestrador | `limmiar-copiloto-teste` | `mvp-copiloto/fly.toml` |
| Juiz | `limmiar-juiz-teste` (região `ord`, com GPU) | `tools/juiz/deploy/fly.toml` |
| App | `limmiar-app` | `apps/app/wrangler.jsonc` |

## Passo a passo

1. **[VOCÊ]** Contas: Fly (com cartão), Cloudflare e Hugging Face (aceite a licença do Gemma na página do modelo). Instale `flyctl` e faça `flyctl auth login`.
2. **[VOCÊ]** Cloudflare: em Workers & Pages, registre o subdomínio `workers.dev`. O app ficará em `https://limmiar-app.<subdomínio>.workers.dev`; chame de `$APP`.
3. **[VOCÊ]** Postgres 17 acessível pelo app da Fly (Fly Managed Postgres ou outro com TLS). Crie o banco `limmiar` e anote duas credenciais: uma de administração, que pode criar o papel `app_role` (a migração cria), e a senha que o `app_role` terá.
4. **[VOCÊ]** Crie os apps: `flyctl apps create limmiar-api-teste`, `flyctl apps create limmiar-copiloto-teste`, `flyctl apps create limmiar-juiz-teste`.
5. **[VOCÊ]** Segredos da API: `flyctl secrets set -a limmiar-api-teste ...` com a tabela abaixo. Para os aleatórios: `openssl rand -hex 32`; para a chave TOTP, `openssl rand -base64 32`.
6. **[VOCÊ]** GitHub, Settings > Secrets and variables > Actions: os três segredos e as duas variáveis da tabela "GitHub".
7. **[VOCÊ]** Rode os workflows (Actions > Run workflow), um por vez: `Deploy API (ambiente de teste)`, `Deploy copiloto (ambiente de teste)`. O release command da API aplica as migrações.
8. **[VOCÊ]** Juiz: siga `tools/juiz/README.md`, seção "Ambiente de teste" (`openssl rand -hex 32` para a chave, `flyctl secrets set`, `bash tools/juiz/deploy/publicar.sh`). Guarde a chave: é o `COPILOTO_JUIZ_CHAVE`.
9. **[VOCÊ]** Segredos do orquestrador (tabela abaixo) e, no repositório, a liberação de teste da D1 (registro assinado em `mvp-copiloto/data/juiz-v2/registro.jsonl`). Reimplante o orquestrador se mudar a imagem; para só trocar segredos, `flyctl secrets set` reinicia a máquina.
10. **[VOCÊ]** Rode `Deploy app (ambiente de teste)`. Ele roda o E2E, constrói com as variáveis e publica na Cloudflare.
11. **[VOCÊ]** Verifique (abaixo) e aprove o profissional de teste: `LIMMIAR_API_URL=https://limmiar-api-teste.fly.dev LIMMIAR_STAFF_API_KEY=<StaffAccess__ApiKey> node tools/approve-local.mjs <email>`.

## Segredos e variáveis

**Fly, `limmiar-api-teste`** (todos `flyctl secrets set -a limmiar-api-teste NOME=valor`):

| Nome | Valor |
|---|---|
| `ConnectionStrings__AdminDb` | string Npgsql do papel administrador (só a migração a usa) |
| `ConnectionStrings__AppDb` | string Npgsql com `Username=app_role` e a senha escolhida no passo 3 |
| `StaffAccess__ApiKey` | aleatório; é a chave do `approve-local.mjs` |
| `AbacatePay__WebhookSecret` | aleatório; a API não sobe sem ele, mas o teste não usa cobrança |
| `Totp__EncryptionKey` | base64 de 32 bytes aleatórios |
| `WebAuthn__RelyingPartyId` | o host de `$APP`, sem `https://` |
| `WebAuthn__ExpectedOrigin` | `https://<host de $APP>` |
| `Cors__AllowedOrigins__0` | `https://<host de $APP>` (vale também para o WebSocket da sessão online) |
| `OnlineSessions__IceServers__0__Urls__0` (e `__Urls__1`...) | URLs `stun:` e `turn:`/`turns:` do provedor de TURN |
| `OnlineSessions__IceServers__0__Username` e `__Credential` | usuário e credencial estáticos do TURN |

Sem os `IceServers`, a sessão online só conecta quando os dois lados alcançam um ao outro (mesma rede, NAT simples). Para
testar entre redes diferentes é preciso um TURN **[VOCÊ]**: um provedor gerenciado com credencial estática ou um coturn
seu. A API entrega a lista ao entrar na sala (`joined`); credencial de curta duração gerada por API do provedor não é suportada.
`RateLimiting__Disabled` não deve ser definido.

**Fly, `limmiar-copiloto-teste`**:

| Nome | Valor |
|---|---|
| `COPILOTO_API_URL` | `https://limmiar-api-teste.fly.dev` |
| `COPILOTO_APP_ORIGEM` | `https://<host de $APP>` (CORS; sem ela o navegador é recusado) |
| `COPILOTO_JUIZ_URL` | `https://limmiar-juiz-teste.fly.dev` |
| `COPILOTO_JUIZ_CHAVE` | a chave do juiz |
| `COPILOTO_JUIZ_VERSAO` | `v2` (a versão registrada em `registro.jsonl`) |

**Fly, `limmiar-juiz-teste`**: `VLLM_API_KEY`, a mesma chave.

**GitHub**:

| Tipo | Nome | Valor |
|---|---|---|
| Secret | `FLY_API_TOKEN` | `flyctl tokens create org`: um token que deploya a API e o orquestrador |
| Secret | `CLOUDFLARE_API_TOKEN` | token com o modelo "Edit Cloudflare Workers" |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | id da conta, no painel da Cloudflare |
| Variable | `VITE_API_BASE_URL` | `https://limmiar-api-teste.fly.dev` |
| Variable | `VITE_COPILOTO_BASE_URL` | `https://limmiar-copiloto-teste.fly.dev` |
| Variable | `VITE_SPEECH_BASE_URL` | a origem do serviço de transcrição (`https://...`), quando existir |
| Variable | `VITE_JUIZ_BASE_URL` | deixe sem valor: só o orquestrador chama o juiz |

As variáveis entram no build como constantes e na CSP (`connect-src` com cada origem e o par `wss:`), sem barra final.
O workflow do app falha se faltar `VITE_API_BASE_URL`, `VITE_COPILOTO_BASE_URL` ou `VITE_SPEECH_BASE_URL`.

## Verificação

```bash
curl -fsS https://limmiar-api-teste.fly.dev/health/db
curl -fsS https://$APP/ -o /dev/null
curl -fsS https://limmiar-copiloto-teste.fly.dev/api/saude     # juiz_llm.no_ar deve vir true, com a versão
curl -fsS https://limmiar-juiz-teste.fly.dev/health            # acorda a GPU; espere alguns minutos
COPILOTO_JUIZ_URL=https://limmiar-juiz-teste.fly.dev COPILOTO_JUIZ_CHAVE=<chave> python tools/juiz/smoke.py
```

## Custo, sem preços

Confira a tabela vigente de cada provedor antes de ligar; esta lista só ordena o que pesa.

| Peça | Cobrança | Peso |
|---|---|---|
| Juiz (GPU) | por hora ligada; parada, só o armazenamento da imagem | alto por hora, perto de zero parado. O risco é esquecer ligado durante um fluxo longo |
| Postgres | mensal fixo, conforme o plano escolhido | costuma ser o maior custo fixo |
| Orquestrador (4 GB) | máquina sempre ligada | médio |
| API (256 MB) | máquina sempre ligada | baixo |
| App (Cloudflare Workers) | gratuito no volume de teste | ~zero |
| TURN | gratuito ou baixo no volume de teste, se gerenciado | baixo |

A API e o orquestrador ficam sempre ligados de propósito: tokens de sessão, salas online e o acervo preparado vivem na memória
do processo, e parar a máquina por ociosidade deslogaria todos e apagaria o acervo. Só o juiz liga e desliga sozinho.
Para economizar entre rodadas, `flyctl scale count 0 -a limmiar-api-teste` (e o mesmo no orquestrador) e volte com `flyctl scale count 1`.

## Não verificado

Nenhum deploy foi feito. Conferidos só no código: os segredos obrigatórios da API (`Program.cs`, `*Composition.cs`) e o formato de
`OnlineSessions:IceServers`. Vêm da documentação e de memória, sem execução: o tamanho `l40s` e a região `ord` da Fly para GPU,
a memória de 4 GB do orquestrador (não medida em contêiner), o limite de tamanho da imagem do juiz e o contexto de build do
`flyctl deploy -c apps/api/fly.toml` rodado da raiz (herdado do workflow anterior).
