# S09-06 — forma

## Tipos

```ts
// PainelProfissional.tsx
type EstadoPainel =
  | { status: 'a-carregar' }
  | { status: 'pronto'; pacientes: ResultadoFonte<DadosPacientes>; sessoes: ResultadoFonte<readonly SessaoAgendada[]> }

type Chaveiro = { kek: CryptoKey | null; accountId: string | null; accessToken: string | null }
type ChaveiroDestrancado = { kek: CryptoKey; accountId: string; accessToken: string }
function chaveiroDestrancado(chaveiro: Chaveiro): chaveiro is ChaveiroDestrancado

// requer-voce.ts (nova fonte única, era declarado 4x)
export type ConsentimentosPorPaciente = { patientId: string; consentimentos: ConsentimentosDoPaciente }

// entities/agenda/sessao.ts (SETE_DIAS_MS saiu, sessoesNaSemana renomeada)
export function contarPorComecar(sessoes: readonly SessaoAgendada[], agora: Date): number

// entities/agenda/api.ts (janela de 7 dias entra aqui, SETE_DIAS_MS privada)
export function listarSessoesDaSemana(
  baseUrl: string, accountId: string, accessToken: string, agora: Date,
): Promise<ListarSessoesResult>
```

## Assinaturas que mudaram

- `sessoesNaSemana(sessoes, agora): number` → `contarPorComecar(sessoes, agora): number` (mesmo corpo, nome honesto: não recorta janela).
- `SETE_DIAS_MS` sai de `entities/agenda/sessao.ts` (exportada) e nasce privada em `entities/agenda/api.ts`.
- `estadoInicial(kek, accountId, accessToken): EstadoPainel` — removida. O render chama `chaveiroDestrancado` direto.
- `carregarPacientes(...)`: o fan-out interno passa de `Promise.allSettled` + type guard para `Promise.all` com `.catch(() => null)` por item.
- **Ronda 2** — o cancelamento não é mais `throw`: `cancelled ? [] : await openSummaries(...)`
  no ponto de consumo (a única chamada cara que vale a pena poupar); o `.catch` de `carregar`
  volta a significar só "erro de rede/JSON de verdade", nunca cancelamento.

## Call tree (fluxo principal, inalterado na forma)

```
PainelProfissional(props)
├─ useState<EstadoPainel>({status:'a-carregar'})           # sempre este default agora
├─ useEffect([kek, accountId, accessToken, baseUrl, openSummaries, i18n, t])
│   ├─ !chaveiroDestrancado → return (sem fetch, sem tocar em estado)
│   └─ chaveiroDestrancado
│       ├─ carregarPacientes → listPatients → (cancelled ? [] : openSummaries) → Promise.all(obterConsentimentos.catch(→null))
│       ├─ carregarSessoes → listarSessoesDaSemana(baseUrl, accId, token, new Date())
│       ├─ Promise.all([pacientes.catch(...), sessoes.catch(...)]) → setEstado('pronto', ...)
│       └─ cleanup: cancelled=true; abort(); setEstado({status:'a-carregar'})  # NOVO
├─ render: !chaveiroDestrancado(props) → <bloqueado/>                          # NOVO (era estado)
├─ render: estado.status === 'a-carregar' → <carregando/>
└─ render: estado.status === 'pronto' → KPIs, ação principal, "Requer você"
```

## Decisão desta fatia

- **Guarda no render é sobre `bloqueado`; o cleanup é sobre "não herdar dados".** São dois
  achados do ticket, duas correções independentes: uma tira `bloqueado` do estado
  (fonte única de verdade = props), a outra garante que o estado nunca sobrevive à troca
  de conta (fonte única de reset = cleanup do efeito, não mais duplicado no início do
  corpo do efeito).
- **(Ronda 1, revertida na ronda 2) Cancelamento via `throw`.** Absorvido pelo `.catch`
  que `carregar` já tinha — funcionava, mas misturava cancelamento com erro de rede de
  verdade no mesmo `.catch` (nota do reviewer-lang). Ronda 2: checagem direta de
  `cancelled` no ponto de consumo (antes de chamar `openSummaries`), sem exceção e sem
  tipo novo — `if (cancelled) return` em `carregar` continua sendo o único freio contra
  um `setEstado` tardio (provado por mutação, ver trace.log §8).
