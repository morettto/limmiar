# S09-01 — forma para o portão (etapa 4)

Desenho do ticket S09-01, sobre `C:\wt-S09-01`. **Nenhuma linha de implementação escrita.**

---

## 1. Decisão de âmbito — a "sessão seguinte"

**O backend não expõe leitura da agenda.** Confirmado, não inferido:

- `apps/api/src/Api/Features/Scheduling/SchedulingEndpoints.cs:18,29,40` — só `POST`, `PATCH`, `DELETE`.
- `apps/api/src/Api/Features/Scheduling/README.md:35-36` — "Sem `GET` (não pedido por nenhum critério de aceite deste ticket)".
- `ScheduledSessionStore.cs` não tem nenhum `SELECT` de listagem (só o `FOR UPDATE` por `id`, `:165`).

Não se inventa endpoint. Consequência: o critério 1 **e** o KPI "sessões na semana" bebem da mesma leitura inexistente.

**Menor seam possível** — a agenda entra por prop, como `BibliotecaRouteComponent` já passa `notas={[]}` e `kek={null}` (`router.tsx:237-241`). Só o que é puro nasce agora:

```ts
// apps/app/src/entities/agenda/sessao.ts        (slice nova; SEM api.ts)
export interface SessaoAgendada {
  readonly sessionId: string
  readonly patientId: string
  readonly inicioEm: string          // ISO 8601 — o StartsAt de ScheduledSessionResponse
  readonly duracaoMinutos: number
  readonly canceladaEm: string | null // ScheduledSessionResponse.CancelledAt
}

/** Pura. A de menor inicioEm que ainda não passou e não está cancelada; null se não houver. */
export function proximaSessao(sessoes: readonly SessaoAgendada[], agora: Date): SessaoAgendada | null

/** Pura. Conta as não canceladas entre agora e agora + 7d. É o KPI, não uma vista de agenda. */
export function sessoesNaSemana(sessoes: readonly SessaoAgendada[], agora: Date): number
```

**Fica de fora:** `entities/agenda/api.ts` (código morto contra uma rota que devolve 405); `packages/agenda` (expande séries RRULE — `scheduled_sessions` são linhas concretas); "Hoje separado do resto da semana" para lá da contagem; mover/cancelar.

**Bloqueio a registar:** o critério 1 fica **verde em teste** (sessões injetadas) e **cinzento em produção** até existir `GET /accounts/{accountId}/agenda/sessions?from=&to=`. É ticket de backend a jusante.

Nota gémea: `accessToken`/`kek` continuam `null` no router (sem `KeychainProvider`), portanto o painel monta em "chaveiro bloqueado" em produção — mesma situação de `PatientWallet`, fora de âmbito.

---

## 2. Tipos e assinaturas

```ts
// apps/app/src/widgets/painel-profissional/requer-voce.ts   [puro, zero React, zero fetch]
export type FonteRequerVoce = 'risco' | 'assinatura' | 'consentimento'

export interface ItemRequerVoce {
  /** `${fonte}:${referencia}`. Chave de deduplicação — único ENTRE fontes por construção. */
  readonly id: string
  readonly fonte: FonteRequerVoce
  /** notaId | patientId | `${patientId}:${finalidade}` */
  readonly referencia: string
  readonly patientId: string
}

export function itensDeRisco(sumarios: readonly SummaryResult[]): ItemRequerVoce[]        // ok && risk === 'elevado'
export function itensDeAssinatura(notas: readonly Nota[]): ItemRequerVoce[]               // estado === ESTADO_PENDENTE
export function itensDeConsentimento(
  porPaciente: readonly { patientId: string; consentimentos: ConsentimentosDoPaciente }[],
): ItemRequerVoce[]                                                                        // uma entrada por finalidade 'pendente'

/** Ignora as fontes em erro; Map por id, primeiro a entrar ganha. Ordem: risco, assinatura, consentimento. */
export function juntarRequerVoce(fontes: readonly ResultadoFonte<readonly ItemRequerVoce[]>[]): readonly ItemRequerVoce[]
```

`ItemRequerVoce` **não carrega o nome do paciente**. O nome só existe decifrado em `SummaryResult` e resolve-se no render por `patientId` — nenhum nome em claro é copiado para uma segunda estrutura.

Ausência de duplicado: a chave é `id`, e `fonte` faz parte dela. O mesmo paciente em `risco` **e** `consentimento` são dois itens legítimos (não perder item); a mesma obrigação entregue duas vezes colapsa (não duplicar).

```ts
export type ResultadoFonte<T> = { ok: true; dados: T } | { ok: false; motivo: string }

type EstadoPainel =
  | { status: 'bloqueado' }                       // kek === null: nenhum pedido sai
  | { status: 'a-carregar' }
  | {
      status: 'pronto'
      pacientes: ResultadoFonte<readonly SummaryResult[]>
      consentimentos: ResultadoFonte<readonly { patientId: string; consentimentos: ConsentimentosDoPaciente }[]>
    }
```

`notas` e `sessoes` são props já resolvidas — não podem falhar, logo não entram no estado assíncrono.

---

## 3. Onde vive cada peça

```text
apps/app/src/
├── entities/agenda/                     # NOVA — tipo + duas puras, sem I/O
│   ├── sessao.ts
│   └── README.md
├── widgets/painel-profissional/         # NOVA — o único sítio que vê nota+paciente+consentimento
│   ├── PainelProfissional.tsx           # carrega, isola a falha, compõe
│   ├── requer-voce.ts                   # os 3 construtores + a junção (puro)
│   └── README.md
└── pages/home/HomePage.tsx              # monta o painel; mantém email/Sair/link do copiloto
```

**Widget, não feature.** Um widget importa três slices de `entities` sem violar nada — `fsd-no-cross-slice` só proíbe irmãos da **mesma** camada (`.dependency-cruiser.cjs:45-57`). Molde em `widgets/patient-wallet` ("carrega, decifra, falha com graça") e `widgets/soap-editor` ("compõe, não decide").

Ligação: `IndexRouteComponent` (`router.tsx:28-31`) passa `accountId`/`accessToken`/`kek`/`notas`/`sessoes` a `HomePage`, molde idêntico a `NotaRouteComponent` (`:221-224`).

---

## 4. Costura da falha isolada

**Mecanismo: `Promise.allSettled` + um `ResultadoFonte` por slot.** Um só `useEffect`, molde de `PatientWallet.tsx:40-79` (`cancelled` + `AbortController`).

Não é `ErrorBoundary`: uma boundary apanha throws de render, não promessas rejeitadas, e desmonta a subárvore — o oposto do que o critério 4 pede.

```text
listPatients falha         → pacientes {ok:false} → KPI "Pacientes ativos" = "—", secção com role="alert"
                             (arrasta risco e consentimento: os patientId vinham daqui)
                             assinatura CONTINUA (vem de notas, prop) e a fila mostra-a
obterConsentimentos falha  → allSettled: só esse paciente fica sem item; os outros de pé
worker não decifra um item → SummaryResult ok:false já previsto: item cai de risco, KPI não o conta
```

Na fonte caída: uma linha `role="alert"` dentro **dessa** secção, com `translateProblemCode(code, params, i18n)` quando há código e o `t` de recurso quando foi um throw. KPI de fonte caída mostra `—`, nunca `0`: um zero lê-se como facto.

---

## 5. Árvore de componentes e call tree

```tsx
<IndexRouteComponent>                                   // app/routing/router.tsx — useSession()
└─ <HomePage email onSair accountId accessToken kek notas sessoes>
   └─ <PainelProfissional>                              // widgets/painel-profissional
      ├─ <HeaderAction>  "▶ Iniciar próxima: Amelia 15:30"   // proximaSessao + nome do sumário
      ├─ <KpiStrip>                                          // packages/ui
      │  ├─ item "Pacientes ativos"
      │  └─ item "Sessões na semana"
      └─ <AdaptivePanel label="Requer você">
         ├─ lista de ItemRequerVoce
         └─ <p role="alert"> por fonte em falha
```

```text
PainelProfissional mount
└─ useEffect([kek, accountId, accessToken])
   ├─ kek === null → {status:'bloqueado'}                    ← nenhum pedido sai
   └─ carregar()
      ├─ listPatients(baseUrl, accountId, accessToken)        → !ok → pacientes {ok:false}
      │  └─ openSummariesInWorker(kek, sealed, signal)        → SummaryResult[]
      └─ Promise.allSettled(patientIds.map(obterConsentimentos))   ← só corre se pacientes ok
render
├─ proximaSessao(sessoes, agora) → patientId → nome do SummaryResult ok
│    sem sessão, ou nome não decifrado → rótulo sem nome (nunca o uuid cru)
└─ juntarRequerVoce([risco, assinatura(notas), consentimento])      [puro]
```

Hora: `new Date(inicioEm).toLocaleTimeString(i18n.locale, {hour:'2-digit',minute:'2-digit'})`, como `NotaPage.tsx:124`.

---

## 6. Fatias TDD, por ordem

| # | Teste vermelho | Asserta |
|---|---|---|
| 1 | `entities/agenda/sessao.test.ts` | `proximaSessao`: vazio → `null`; menor `inicioEm >= agora`; salta cancelada; salta passada. `sessoesNaSemana`: só a janela de 7 dias, sem canceladas. |
| 2 | `widgets/painel-profissional/requer-voce.test.ts` | **Critério 2.** Mesmo `patientId` nas 3 fontes → 3 itens. Mesmo item duas vezes → 1. Fonte `{ok:false}` → ignorada, outras intactas. |
| 3 | `widgets/painel-profissional/PainelProfissional.test.tsx` | **Critério 1.** Sessões + sumários → botão `▶ Iniciar próxima: Amelia 15:30`. Sem sessão → rótulo sem nome. Sumário `ok:false` → nunca o uuid. |
| 4 | mesmo ficheiro | **Critério 4.** `listPatients` 500 → `role="alert"`, KPI `—`, assinatura ainda na fila. Um `obterConsentimentos` rejeita → os outros aparecem. |
| 5 | mesmo ficheiro | **Critério 3.** Exatamente dois KPI, "Pacientes ativos" e "Sessões na semana". `queryByText` de `/notas assinadas/` e `/insights/` → `null`. |
| 6 | `pages/home/HomePage.test.tsx` | `HomePage` monta o painel com as props da sessão; os 3 casos atuais continuam verdes. |

---

## 7. `ficheiros_previstos`

| Ficheiro | Responsabilidade |
|---|---|
| **novo** `apps/app/src/entities/agenda/sessao.ts` | `SessaoAgendada`, `proximaSessao`, `sessoesNaSemana` |
| **novo** `apps/app/src/entities/agenda/sessao.test.ts` | fatia 1 |
| **novo** `apps/app/src/entities/agenda/README.md` | doc-sync-gate |
| **novo** `apps/app/src/widgets/painel-profissional/requer-voce.ts` | 3 construtores + `juntarRequerVoce` |
| **novo** `apps/app/src/widgets/painel-profissional/requer-voce.test.ts` | fatia 2 |
| **novo** `apps/app/src/widgets/painel-profissional/PainelProfissional.tsx` | carrega, isola a falha, compõe |
| **novo** `apps/app/src/widgets/painel-profissional/PainelProfissional.test.tsx` | fatias 3, 4, 5 |
| **novo** `apps/app/src/widgets/painel-profissional/README.md` | doc-sync-gate |
| toca `apps/app/src/pages/home/HomePage.tsx` | props novas + monta o painel |
| toca `apps/app/src/pages/home/HomePage.test.tsx` | fatia 6 |
| toca `apps/app/src/app/routing/router.tsx` | `IndexRouteComponent` passa as props |
| toca `apps/app/src/locales/*/messages.po` | `lingui extract` |
| toca `ARCHITECTURE.md` | doc-sync-gate — índice das duas slices novas |

---

## ADR

Nenhuma. O bloqueio da agenda é reversível (o GET aparece, a prop vira `api.ts`) e já está por escrito no README do `Scheduling`. O fan-out N+1 dos consentimentos marca-se com um comentário `ponytail:` no `useEffect` (upgrade: endpoint de consentimentos em lote).

---

## Decisões que esperam o humano

1. **Critério 1 não fecha em produção**: não há `GET` na agenda. Ou verde-em-teste mais um ticket de backend a seguir, ou o âmbito cresce para incluir o GET (endpoint, query no store, RLS, testes).
2. **"Assinatura pendente" também não tem fonte real**: não existe listagem de notas, e `router.tsx:241` já passa `notas={[]}`. Em produção a fila nasce vazia nessas duas fontes.
3. **Acoplamento pacientes → consentimentos** é inevitável (os `patientId` vêm da lista); a falha da lista leva duas das três fontes. Continua a cumprir o critério 4, e o teste da fatia 4 afirma-o.
