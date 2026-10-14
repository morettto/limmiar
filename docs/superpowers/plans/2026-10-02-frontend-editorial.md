# Frontend editorial do Limmiar — Implementation Plan

> **Para execução:** implementar em sequência na próxima tarefa local do frontend.
> A escolha de execução já foi feita pelo usuário; não pedir nova confirmação.
> Aplicar as skills disponíveis quando necessárias, sem depender de um plugin
> `superpowers` inexistente nem abrir trabalho paralelo por padrão.

**Goal:** Fazer todas as páginas do Limmiar seguirem a referência editorial enviada,
com fundo creme, serifas de exposição, UI mono, bordas finas e acento amarelo contido.

**Architecture:** Centralizar os tokens CSS no pacote `@limmiar/ui` existente e
consumi-los no app React, no site Astro e no ambiente de testes visuais. Atualizar
as sete primitivas existentes antes de compor as páginas. Preservar suas funções,
handlers, consentimentos, dados cifrados e estados de sessão durante a troca visual.

**Tech Stack:** React 19, Tailwind 4, Astro, Lingui, `@limmiar/ui`, Playwright CT,
Vitest e axe já presentes. Fraunces e IBM Plex Mono locais, em WOFF2, com licenças.

**Spec:** [Referência integral](../../design/frontend-editorial-reference.md),
copiada sem alterações do arquivo enviado pelo usuário. O plano adapta a linguagem
visual ao produto Limmiar; os exemplos de outra marca não são requisitos funcionais.

## Global Constraints

- Tema claro: canvas `#f6f6f4`, cartões `#ffffff`, texto `#000000`, ações primárias
  e painéis escuros `#2c2c26`, bordas `#d0d0c8`, texto secundário `#6d6e5e`.
- Paleta completa: `#57584b`, `#979886`, `#aaab9c`, `#e8e7d9`, `#aaa674` e
  `#fff347`, com os papéis definidos na referência. Não usar roxo, azul ou cinza frio.
- Amarelo só em marca decorativa pequena, traço de 2–4px ou bloco pequeno até 120px.
  Máximo quatro ocorrências por tela. Nunca texto amarelo, botão amarelo ou fundo amplo.
- Sem sombras e sem gradientes. Cards com raio 8px; botões, tags e nav com raio 3px.
  Bordas de 1px. Máximo de conteúdo 1200px; cards com padding 24px; seções principais
  separadas por 80px. Unidade espacial 4px, escala 4/8/12/16/24/32/64/80/128.
- Títulos: Fraunces 300/400, tracking `-0.05em`, escala 24/32/48/64/96px.
  Corpo e controles: IBM Plex Mono 400/500, escala 12/14/16/20px, tracking conforme
  a referência. Usar `px` nos tokens de line-height normalizados: `90` significa
  `90px` para o display de 96px, não um multiplicador de noventa linhas.
- Fontes servidas localmente. Nenhuma requisição a Google Fonts na sessão clínica;
  preservar CSP, COOP/COEP, funcionamento local e os quatro idiomas.
- Nome, textos e finalidade são do Limmiar. Não copiar wordmark VISUAL, waitlist,
  claims de receita, mockups de produto ou botões sem uma ação real.
- A referência é visual. Preservar navegação adaptativa desktop/tablet/mobile já
  exigida pelo vault e alvos de toque de pelo menos 44px, 48px na ação móvel.
- Foco visível, contraste AA, labels e mensagens sem depender só de cor. Sage/Moss
  claros ficam em decoração ou informação redundante; texto essencial usa Ink/Lichen.
- Sem reestruturar slices, introduzir nova biblioteca de componentes ou reduzir
  cobertura/portões para concluir a troca visual. MiniSearch não entra em um lote
  de dependências; nenhuma atualização de dependências é necessária ao redesign.
- A implementação funcional está ativa neste checkout. Releia os arquivos antes
  de editar, preserve mudanças locais e mantenha handlers/props existentes.
  Comece por tokens, fontes, primitivas e Astro. Em SessionReview/PatientCare/Home,
  altere somente apresentação; não substituir funções por fixtures ou mocks.

## Inventário de telas

| Área | Arquivos atuais | Resultado visual e estados a cobrir |
| --- | --- | --- |
| Entrada/cadastro | `apps/app/src/pages/auth/AuthPage.tsx`, `widgets/auth-screen/AuthScreen.tsx` | Cabeçalho editorial, formulário Paper, papéis, erros e envio em andamento. |
| 2FA | `features/totp-enrollment/TotpSetup.tsx`, `features/totp-challenge/TotpChallenge.tsx` | QR/backup em painel limpo; labels, recuperação, validação e sucesso. |
| Magic link/recuperação | `features/magic-link-auth/MagicLinkCallback.tsx`, `features/recovery/{RecoveryScreen,RecoveryPhraseSetup}.tsx`, `pages/recovery/RecoveryPhraseSetupPage.tsx` | Espera, expirado/inválido, frase em grade mono legível e ação confirmada. |
| Dispositivos | `pages/device-pairing/{PairPrimaryPage,PairNewPage}.tsx`, `features/device-pairing-{primary,new}/*.tsx`, `features/qr-scan/PairingScan.tsx` | QR, câmera, instruções e estados de pareamento; zero sombras nas gavetas. |
| Consultório/painel | `pages/home/HomePage.tsx`, `widgets/painel-profissional/PainelProfissional.tsx` | Navegação existente, heading editorial, ação principal Carbon, fila e verificações. |
| Pacientes/prontuário | `widgets/patient-care/PatientCare.tsx`, `widgets/patient-wallet/PatientWallet.tsx` | Cadastro, lista, paciente selecionado, consentimento e histórico, todos legíveis. |
| Agenda | `packages/ui/src/CalendarViewport.tsx` e composição de agenda presente no checkout | Calendário com hairlines, labels mono e seleção Bone, mantendo interação real. |
| Sessão/transcrição | `features/live-session/SessionReview.tsx` | Microfone, processamento, vozes, palavras, correção, salvar/descartar e revisões cifradas. |
| Notas/SOAP | `pages/notas/NotaPage.tsx`, `widgets/soap-editor/FilaEEditor.tsx`, `features/nota-editor/{EditorSoap,Citacao}.tsx`, `features/nota-fila/FilaAssinatura.tsx` | Editor sem ruído visual, referências e assinatura; pendente/assinada/erro/sem dados. |
| Biblioteca | `pages/biblioteca/BibliotecaPage.tsx`, `widgets/biblioteca/BibliotecaNotas.tsx` | Busca, resultados, grupos e filtros com mesmos tokens, incluindo índice preparando/erro. |
| Copiloto | `pages/settings/CopilotKeyPage.tsx`, `features/copilot-byok/CopilotKeySetup.tsx` e cartões presentes | Configuração Paper, propostas/citações com hierarquia editorial; nenhum resultado fictício. |
| Paciente/check-in | `pages/paciente-hoje/PacienteHojePage.tsx`, `widgets/contacto-emergencia/ContactoEmergencia.tsx` | Entrada simples, campos mono, ação Carbon e emergência sempre reconhecível/acessível. |
| Vínculo/partilha | `features/vinculo/{GerarConviteVinculo,ResgatarConviteVinculo,DesvincularVinculo}.tsx`, `features/partilha/{PartilhaCheckIns,EspelhoP6}.tsx` | Convite, consentimento granular, revogação e estados vazios sem informação inventada. |
| Site público | `apps/site/src/layouts/BaseLayout.astro`, `pages/{pt-br,es-419,it-it,en-us}/index.astro`, `lib/content.ts` | Hero editorial, navegação fina, seções de 80px e footer Carbon em quatro idiomas. |
| Booking/plano/admin/medicação | Descobrir a composição real ao iniciar a tarefa; código histórico pode estar em outro worktree | Estilizar as telas efetivamente incorporadas ao produto, sem criar backend ou fluxo falso para preencher tela. |
| Erro/vazio/carregamento | Todas as áreas acima | Mesma linguagem; ações claras, foco conservado e textos existentes traduzidos. |

Não considerar a tarefa concluída só porque a Home ganhou fundo creme: o inventário
deve ter evidência visual por página e estado importante. Atualizar este inventário
com os caminhos de telas novas que a implementação funcional incorporar.

## Task 1: Tokens, fontes e canvas comum

**Files:** criar `packages/ui/tokens.css`; exportar CSS em `packages/ui/package.json`;
modificar `apps/app/src/index.css`, `packages/ui/playwright/index.css` e
`apps/site/src/layouts/BaseLayout.astro`; incluir arquivos WOFF2 e licenças no pacote UI.

**Interfaces:** produz `@limmiar/ui/tokens.css`, `--font-editorial`, `--font-interface`,
cores/spacings/radii da referência. Os consumidores importam a mesma folha CSS.

- [x] Ler integralmente a referência e os CSS atuais; localizar utilitários roxos,
  sombras, `prefers-color-scheme: dark` e `color-scheme: light dark` antes de substituir.
- [x] Obter Fraunces 300/400 e IBM Plex Mono 400/500 das fontes oficiais; preservar
  licenças e acentos pt/es/it/en. Usar `font-display: swap` e fontes de fallback.
- [x] Criar CSS nativo compartilhado, incluindo todas as cores e escala da referência:

```css
:root {
  --color-vellum: #f6f6f4;
  --color-paper: #ffffff;
  --color-ink: #000000;
  --color-carbon: #2c2c26;
  --color-ash: #d0d0c8;
  --color-olive-char: #57584b;
  --color-lichen: #6d6e5e;
  --color-sage: #979886;
  --color-moss: #aaab9c;
  --color-bone: #e8e7d9;
  --color-highlighter-yellow: #fff347;
  --color-khaki-olive: #aaa674;
  --font-editorial: Fraunces, Georgia, serif;
  --font-interface: 'IBM Plex Mono', Consolas, monospace;
  --radius-sm: 3px;
  --radius-lg: 8px;
  --page-max-width: 1200px;
  --section-gap: 80px;
  --card-padding: 24px;
}
body { margin: 0; color: var(--color-ink); background: var(--color-vellum); }
```

- [x] Importar o CSS compartilhado no app/CT e no BaseLayout Astro. Astro pode usar
  import relativo ao pacote, evitando adicionar dependência React ao site só para CSS.
  Manter Tailwind no app; mapear seus tokens `@theme` para os valores comuns.
- [x] Remover tema roxo/dark automático e aliases antigos sem consumidores. Tornar
  o root responsivo com máximo 1200px, sem largura fixa que cause overflow móvel.
- [x] Verificar app e site locais com fontes carregadas e sem requests externos de
  fonte. Rodar `pnpm --filter app build` e `pnpm --filter site build`.

## Task 2: Sete primitivas e controles

**Files:** modificar `packages/ui/src/{AdaptiveNav,Columns,CalendarViewport,HeaderAction,KpiStrip,AdaptivePanel,AdaptiveTable}.tsx`,
testes CT existentes e `packages/ui/playwright/index.css`.

**Interfaces:** manter as props públicas e callbacks existentes. Usar tokens CSS e
as classes semânticas `editorial-card`, `editorial-eyebrow`, `button-primary`,
`button-secondary` e `editorial-badge`, definidas no CSS comum quando compartilhadas.

- [x] Trocar `neutral-*`, raios arbitrários e `shadow-*` por tokens: Paper, Ash,
  Carbon e Bone. Preservar sidebar/rail/barra inferior e comportamento de gaveta.
- [x] Padronizar controles sem alterar tipos/handlers. Exemplo de estilos concretos:

```css
.button-primary, .button-secondary {
  min-height: 44px;
  padding: 8px 16px;
  border: 1px solid var(--color-carbon);
  border-radius: var(--radius-sm);
  font: 500 14px/20px var(--font-interface);
  box-shadow: none;
}
.button-primary { background: var(--color-carbon); color: var(--color-paper); }
.button-secondary { background: transparent; color: var(--color-ink); }
:where(button, a, input, select, textarea):focus-visible {
  outline: 2px solid var(--color-ink);
  outline-offset: 3px;
}
```

- [x] Aplicar 8px nas superfícies e 3px em controles; preservar 44px de toque e
  a ação HeaderAction de 48px acima da navegação móvel. Não zerar layout-constants.
- [x] Rodar `pnpm --filter @limmiar/ui test:unit` e `pnpm --filter @limmiar/ui test:visual`.
  Conferir imagens novas antes de aceitar baselines; manter axe e testes de overflow.

## Task 3: Acesso, recuperação, dispositivos e paciente

**Files:** páginas/features de entrada, 2FA, recovery, pairing, `/hoje`, vínculo,
partilha e emergência listadas no inventário; seus testes existentes.

**Interfaces:** mesmas props e retornos de autenticação. Nada de substituir KEK,
token, conta, pacientes ou consentimentos por fixtures durante a troca visual.

- [x] Envolver cabeçalhos/formulários em superfície e tipografia editorial:

```tsx
<main className="editorial-page">
  <header className="editorial-header">
    <p className="editorial-eyebrow">Limmiar</p>
    <h1 className="editorial-title"><Trans>Bem-vindo ao Limmiar</Trans></h1>
  </header>
</main>
```

- [x] Conservar texto de instrução, validação e sucesso. Usar label acima do campo,
  borda de 1px, fundo Paper, espaçamento 16px e ação principal Carbon. Frase/QR
  não podem estourar 390px; grade da frase conserva ordem e número das palavras.
- [ ] Ajustar todos os estados das telas enumeradas, inclusive botão disabled,
  código inválido, espera e falha de servidor. Emergência não pode ficar escondida
  em uma gaveta nem depender do amarelo para ser reconhecida.
- [ ] Rodar testes dessas features e validar por teclado, em 390/768/1024/1440px,
  com quatro idiomas e pseudo-locale onde o harness já oferecer.

## Task 4: Consultório, sessão, SOAP, biblioteca e copiloto

**Files:** `pages/home/HomePage.tsx`, `widgets/painel-profissional/PainelProfissional.tsx`,
`widgets/{patient-care,patient-wallet,soap-editor,biblioteca}/`,
`features/live-session/SessionReview.tsx`, `pages/{notas,biblioteca,settings}/`,
`features/{nota-editor,nota-fila,copilot-byok}/` e testes dessas áreas.

**Interfaces:** preservar `onSelect`, `onPendingChange`, dados de prontuário,
`SessionReviewProps`, `Nota`, palavras/tempos/papéis, revisões e aprovação de propostas.

- [x] Aplicar título serifado de 64–96px na página, 32–48px nas seções e 24px nos
  subtítulos. Corpo clínico fica mono 16px/24px; nomes, metadados e labels não se
  confundem com conteúdo da transcrição.
- [ ] Reorganizar a apresentação usando Columns/AdaptivePanel existentes. Cards
  de conteúdo com 24px, gap de 24px entre colunas e 80px entre seções principais;
  campos e itens internos mantêm densidade útil de 8/16px.
- [x] Dar ações primárias claras a iniciar/encerrar, salvar e assinar. Secundárias
  usam outline e gap 8px quando houver ação real. Nunca acrescentar CTA decorativo.
- [x] Exibir falas por pessoa e tempo, correção palavra a palavra e histórico com
  mesmas fontes/bordas. Preservar bloqueio de saída com alterações pendentes,
  revisão explícita, append-only, erros e ausência de armazenamento de áudio.
- [ ] Tratar cartões de fontes com título serifado, citação mono e referência
  legível. Preservar todas as fontes qualificadas; não truncar o conteúdo clínico
  para fazer caber um card e não apresentar resultados fictícios.
- [ ] Validar busca, edição, assinatura, consentimento, gravação e retomada no
  produto real. Rodar testes dessas áreas, `pnpm --filter app lint`, `lint:arch`
  e `test:unit`, mantendo os limiares atuais.

## Task 5: Site público e fechamento de todas as páginas

**Files:** `apps/site/src/layouts/BaseLayout.astro`, as quatro páginas de locale,
`apps/site/src/lib/content.ts`, CSS comum e testes de site/CT existentes.

**Interfaces:** preservar locale, canonical, alternates hreflang, conteúdos
traduzidos e destino real das ações públicas. Sem claims clínicos ou preço inventado.

- [ ] Compor hero central com eyebrow, título Fraunces, subtítulo mono até 560px
  e par de ações somente se os dois destinos reais existirem. Nav fina ~56px;
  footer Carbon com links existentes; manter a marca Limmiar.
- [ ] Aplicar seções espaçadas, cartões Paper ou painel Carbon com borda Olive Char
  quando o conteúdo existente pedir contraste. Amarelo no máximo quatro marcas,
  sempre decorativas e com `aria-hidden="true"`.
- [x] Rodar `pnpm --filter site build`, `test:unit` e `test:e2e`. Conferir locale,
  canonical e hreflang, nav por teclado e legibilidade em mobile.
- [ ] Completar o inventário com screenshots reais em desktop/mobile, incluindo
  erro/vazio/carregamento. A prova de ausência de overflow usada nos testes pode
  seguir o padrão nativo abaixo em um teste Playwright do produto, após a tela carregar:

```ts
const semOverflow = await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth,
)
expect(semOverflow).toBe(true)
```

- [x] Reextrair/traduzir só mensagens novas: `pnpm --filter app check:i18n-extract`,
  `check:i18n-complete` e `lint:i18n`. Não apagar traduções existentes.
- [ ] Rever todas as imagens e interações; corrigir qualquer página que ainda use
  tema roxo, fundo branco de canvas, sombras ou botões fora do sistema.
- [ ] Entregar screenshots, URL local e resumo dos testes. Não anunciar todas as
  páginas prontas com prova de uma única tela. Não commitar/pushar automaticamente.

## Critérios de aceite

- [ ] O inventário completo tem evidência visual e interação real, não só componentes.
- [x] App, site e primitivas usam os mesmos tokens e as duas fontes locais.
- [x] Canvas creme, superfícies planas, bordas de 1px, raios 8/3px e acento contido.
- [x] Títulos editoriais e corpo mono são reconhecíveis nas páginas existentes.
- [ ] Mobile/tablet/desktop sem corte, sobreposição ou scroll horizontal.
- [ ] Foco, contraste, alvos de toque e estados de erro preservados; axe passa.
- [x] Quatro idiomas compilaram sem mensagens faltantes.
- [ ] Salvar/assinar/reabrir, consentimento, autenticação e transcrição continuam
  funcionando com dados reais; nenhuma retenção de áudio introduzida.
- [x] Builds, lint, arquitetura e testes afetados passam sem relaxar portões.

Self-review: cores, tipografia, espaçamento, formas, navegação, cards, botões,
badges, footer, imagens, responsividade e estados da referência estão atribuídos
às tarefas 1–5. Exemplos visuais de outra marca foram traduzidos em papéis do Limmiar,
sem criar funcionalidades para reproduzir uma imagem de marketing.

## Registro de implementação e evidências (2026-10-02)

O registro abaixo corresponde à primeira execução da tarefa de frontend. As falhas
de build, teste e traduções que ela registrou foram corrigidas na consolidação
posterior, documentada ao final. Pendências funcionais continuam explícitas.

- Sistema comum aplicado em `packages/ui/tokens.css`, `packages/ui/tailwind.css`,
  `apps/app/src/index.css` e `apps/site/src/layouts/BaseLayout.astro`. Fraunces e
  IBM Plex Mono são servidas como arquivos locais. Layout público mantém os quatro
  locales, canonical, hreflang e as mensagens existentes.
- Primitivas cobertas por snapshots: AdaptiveNav, AdaptivePanel, AdaptiveTable,
  CalendarViewport, Columns, HeaderAction e KpiStrip. Foram preservados contratos
  de props e callbacks; contraste axe e alvos de toque passaram nos breakpoints
  previstos pelo harness. Resultado: 195 testes passaram e 25 foram pulados por
  breakpoint não aplicável.
- App: estilos comuns cobrem autenticação, formulários, estados e superfícies; a
  área “Paciente hoje” e Biblioteca receberam classes editoriais na raiz. A
  captura disponível mostra cadastro/entrada em `/`; as demais páginas que exigem
  sessão autenticada não foram capturadas com dados reais nesta execução.
- Site público: as quatro rotas de locale usam a composição editorial “Em breve”.
  Capturas manuais em desktop (1280px) e mobile (390px) estão em
  `C:/Users/m0retto/.codex/visualizations/2026/10/03/01a0ff16-5f9f-7730-b757-2be4b82ebcb1/`.
  O E2E de roteamento passou (13 testes), assim como build e testes unitários do
  site (9 testes).
- App: lint e lint de arquitetura passaram. O build TypeScript completo está
  bloqueado por `SessionReview.tsx:170` (tipo UUID/string na alteração local da
  sessão). O build Vite isolado passou. A suíte unitária teve 903 aprovações e 1
  falha em `account-keys.test.ts`; `check:i18n-extract` passou, mas compilação
  estrita informa 115 mensagens ausentes em cada catálogo `en-US`, `es-419` e
  `it-IT`, existentes no estado atual do checkout. Nenhuma tradução foi removida.
- Inventário de estados com sessão real (erro, vazio, carregamento, revisão,
  assinatura e retomada) segue pendente de evidência visual; os screenshots acima
  não são evidência dessas interações. Não houve mudança em API, juiz, fixtures,
  fluxo de áudio ou lógica funcional de SessionReview/PatientCare/HomePage.

## Consolidação da tarefa principal — 2 de outubro, 22:46

As falhas do primeiro registro foram resolvidas. Build completo do app
(`tsc -b && vite build`), lint e arquitetura passaram. São 292 mensagens ativas,
sem traduções ausentes, e compilação estrita dos quatro catálogos aprovada.
A suíte completa passou 917 testes em 108 arquivos, com 100% nas quatro métricas.
Lint tem avisos existentes, sem erros; não houve redução de limiares.

Entrada ganhou título Fraunces de exposição. Recuperação, biblioteca, notas e
configuração do copiloto têm hierarquia editorial e área principal identificada.
O layout do paciente preserva emergência visível. Consentimentos ocupam linhas
separadas; captura e salvamento da transcrição usam a ação Carbon. Canvas, fontes,
escala, tracking, cards, foco e controles vêm da folha comum. Os CTs do app agora
importam o CSS real do produto, incluindo essas regras.

| Prova final | Resultado e limite |
| --- | --- |
| App unitário | 917 aprovados; 100% statements, branches, functions e lines. |
| Primitivas unitárias | 91 aprovados; 100% nas quatro métricas. |
| Primitivas visuais | 195 aprovados; 25 casos não aplicáveis ao breakpoint. Quatro idiomas e pseudo-locale, axe e toque. |
| CT visual do app | 20 aprovados: entrada profissional/paciente, configuração TOTP, códigos de backup e biblioteca. Breakpoints 375/900/1150/1440px, axe sem violações. |
| E2E de páginas | 72 aprovados: entrada, recuperação, copiloto bloqueado, biblioteca preparando, paciente bloqueado e magic link inválido. Quatro idiomas × 390/768/1440px; um main, h1 visível, sem overflow e sem violações axe. |
| E2E de prontuário/recuperação | 6 aprovados: cenário completo e frase inválida em três tamanhos. Cria profissional, confirma 2FA e verificação documental, cria paciente e nota assinada; novo contexto recupera sem senha antiga e reabre a mesma nota. |
| Site | Build das quatro páginas, 9 unitários e 13 E2Es aprovados; canonical e hreflang preservados. Conteúdo existente continua “Em breve”; isso não implementa booking nem a integração comercial pendente. |

Capturas atuais com dados fictícios, no checkout local:

- `.local/capturas/entrada-editorial.png`
- `.local/capturas/recuperacao-editorial.png`
- `.local/capturas/copiloto-editorial.png`
- `.local/capturas/notas-editorial.png`
- `.local/capturas/prontuario-recuperado.png`
- `.local/capturas/site-editorial.png`
- `.local/recovery-e2e-results/`: 75 capturas de páginas e prontuário, incluindo
  desktop, tablet e celular. Não há captura contendo a frase de recuperação.

Os logs da consolidação estão em `.local/{app-fecho-visual,editorial-produto-e2e,
app-visual-editorial,ui-visual-editorial-fecho,site-e2e-editorial-fecho}.log`.
O app permanece acessível em `http://localhost:5173`. Para conferir o site,
o preview já aberto usa `http://127.0.0.1:4341/pt-br/`.

O runner local usa um PostgreSQL separado em 5433, API em 5269 e frontend de
teste em 8787. Não modifica as credenciais do banco local em 5432. A configuração
específica dessa máquina foi preservada em `.local/playwright-recovery.config.ts`.
As suites de produto continuam em `apps/app/e2e/`; o config regular ganhou o
segredo fictício obrigatório do webhook. O preview do E2E do site usa a API pública
do Astro, pois a CLI sob agentes inicia em segundo plano e sai antes do Playwright.

Modelos antigos baixados em `public/models` impediam o Wrangler de iniciar.
A exclusão nativa `.assetsignore` retira essa pasta dos assets servidos; nenhum
arquivo original de modelo foi apagado. O [mecanismo oficial do Wrangler](https://developers.cloudflare.com/workers/static-assets/binding/#ignoring-assets)
é usado também no teste. Vite ignora artefatos de build/CT para evitar falha de watch.

A revisão automática recusou apagar 16 baselines antigas com a mensagem
“blocked by policy”. Elas ficaram preservadas em `__screenshots__/auth`; o
Playwright usa as novas localizações `widgets/auth-screen` e `features/totp-enrollment`.

O sistema visual foi aplicado às páginas existentes. O inventário ainda exige
prova quando forem ligados os fluxos ausentes: biblioteca populada, agenda/painel,
pairing real, sessão ao vivo com transcrição revisada e insights qualificados.
Não há cartões bibliográficos qualificados fictícios para preencher as telas.
As caixas abertas do plano representam essas verificações e integrações; não
representam ausência dos tokens compartilhados. O fecho funcional continua em
[implementacao-final-limmiar.md](../../implementacao-final-limmiar.md).
