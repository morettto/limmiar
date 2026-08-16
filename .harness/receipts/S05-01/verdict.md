# S05-01 · Máquina XState da sessão, cobertura de caminho total

Status: **pronto**, com uma decisão de produto/segurança sinalizada e não decidida (ver secção final — não bloqueia o ticket, mas precisa de dono humano antes de S05-02).

## O que foi feito

Novo pacote `packages/session/` (scaffold igual a `packages/agenda`: TypeScript strict, vitest+istanbul 100% cobertura por ficheiro, oxlint, dependency-cruiser, Stryker mutação break=95):

- `src/types.ts` — contrato (`SessaoContexto`, `SessaoEvento` união discriminada, `Falha` união discriminada, `Marco`, `CriarMaquinaSessaoOpcoes`), zero import de `xstate`.
- `src/machine.ts` — `criarMaquinaSessao(opcoes?)`, XState v5 (`setup`+`createMachine`), sem `invoke` (ADR-0008).
- `src/index.ts` — reexport.
- `src/machine.test.ts` — as 24 linhas da tabela de mesa do ticket, uma por teste.
- `src/machine.paths.test.ts` — `@xstate/test` (`createTestModel`/`getShortestPaths`/`getAdjacencyList`) a partir de dois contextos iniciais (`chunksOrfaos: 0` e `7`), cobrindo `recuperando` e `interrompido` como o critério de aceite exige.
- `README.md` + entrada em `ARCHITECTURE.md` (doc-sync-gate).

## Critérios de aceite do ticket

- [x] `@xstate/test` cobre todo o estado alcançável, incluindo `recuperar` e `interrompido` — dois modelos (`chunksOrfaos: 0`/`7`), `getShortestPaths` + `getAdjacencyList`.
- [x] Microfone revogado, GPU perdida e disco cheio têm transição explícita modelada — declaradas uma única vez no `on` de `ativa` (bubbling), confirmado pelo review de spec linha a linha.
- [x] Teste de mesa registado nos critérios de aceite antes da implementação — já estava no próprio ticket; as 24 linhas foram confirmadas uma a uma contra `machine.ts` pelo review de spec.

## Testes a correr

```
pnpm --filter @limmiar/session exec tsc --noEmit -p tsconfig.json   # limpo
pnpm --filter @limmiar/session lint                                  # limpo (oxlint)
pnpm --filter @limmiar/session lint:arch                             # limpo (dependency-cruiser)
pnpm --filter @limmiar/session test:unit                             # 33/33, 100% statements/branches/functions/lines
pnpm --filter @limmiar/session test:mutation                         # 95.83% (break threshold 95)
```

Mutantes sobreviventes (4, todos confirmados equivalentes por teste empírico, não são gap de teste):
- 2× erasão de `types: { context: {} as X, events: {} as Y }` → `types: {}` — sintaxe apagada em runtime pelo TypeScript (`erasableSyntaxOnly`), nenhum teste comportamental consegue matar.
- 2× `historico: { type: 'history', history: 'shallow' }` com `type`/`history` mutados para `""` — verificado num repro isolado (`node --experimental-strip-types`) que o XState v5 restaura o histórico de qualquer forma; comportamento idêntico, mutante equivalente.

## Review-chain (5 eixos em paralelo, 1 ronda de correção)

Achados reais e corrigidos:
- **Estrutural (bloqueante):** o estado transiente `inicializando` + guard `temChunksOrfaos` + campo `chunksOrfaos` no contexto existiam para contornar uma limitação do XState que não existe (`initial` pode ser calculado em runtime numa factory). Removido; `initial` agora é um ternário direto. Verificado: lista de adjacência do `@xstate/test` byte-idêntica antes/depois para `chunksOrfaos = 0` e `= 7`.
- **Estrutural (bloqueante):** a regra `no-xstate-in-types` do `.dependency-cruiser.cjs` nunca disparava (`to.path` casa contra o caminho *resolvido*, não o especificador — `^xstate$` nunca bate em `node_modules/.../xstate/dist/...`). Corrigido para `{ dependencyTypes: ['npm'], path: 'node_modules/xstate/' }`, verificado a disparar (`error no-xstate-in-types`, exit 1) com um import de teste e depois revertido.
- **Higiene (bloqueante):** ficheiros de sonda deixados por um dos próprios subagentes de review (`zz_input.ts`/`.test.ts`, criados via Bash como prova empírica de uma alternativa rejeitada) ficaram em `src/` com o typecheck do pacote partido. Removidos.
- **Spec (bloqueante):** pelo mesmo motivo, `machine.alt.ts`/`machine.alt.test.ts` apareceram brevemente no working tree durante os reviews paralelos (não fazem parte da lista de 5 ficheiros do ticket). Removidos.
- **Linguagem/lean (notas):** `index.ts` agora usa extensão `.ts` explícita como o resto do pacote; `serializeState` em `machine.paths.test.ts` tipado com `AnyMachineSnapshot` (de `xstate`) em vez de um tipo estrutural ad hoc; catálogo de eventos de exemplo trocado por `Record` exaustivo sobre `SessaoEvento['type']` (esquecer um evento novo passa a ser erro de compilação); os dois `TestModel` deixaram de ser reconstruídos a cada `describe`, agora são constantes de módulo reutilizadas.
- **Spec (nota):** teste 24 ("qualquer evento é absorvido") só enviava `ENCERRAR`; agora envia também `MODELO_PRONTO` para provar que não é só aquele evento específico.

Não corrigido (decisão consciente, dentro do âmbito do ticket):
- `Marco { offsetMs }` como wrapper de um único campo (nota do review lean) — mantido; domínio ganha nome próprio, custo é uma interface de 3 linhas.
- Regra `no-xstate-in-types` em si (nota do review lean, "flexibilidade hipotética") — mantida porque o ticket especifica literalmente "`src/types.ts` (contrato, zero import de `xstate`)" na secção Forma; não é hipotética, é requisito do ticket.
- `encerrando` só trata `FILA_DRENADA`, sem caminho de falha de drenagem (nota estrutural) — fora da tabela de mesa de 24 linhas do ticket; adicionar um evento novo seria expandir o âmbito além do que foi acordado no portão de desenho.

## Decisão em aberto — precisa de humano (não bloqueia este ticket, mas é pré-requisito para S05-02)

O review de segurança encontrou um gap real: `recuperando` chega a `ativa` (via `RECUPERACAO_CONCLUIDA` ou via `interrompido`→`TENTAR_NOVAMENTE`) sem nunca passar por `CONSENTIMENTO_CONCEDIDO` — exatamente como a tabela de mesa do ticket especifica nas linhas 16 e 19. Implementado fielmente à tabela, que é o portão de desenho já fechado antes desta implementação (ac #3). Não alterei o comportamento.

O que fiz, sem mudar nenhuma transição: acrescentei `opcoes.consentimentoEm?: string` a `CriarMaquinaSessaoOpcoes`, semeado no contexto inicial — puramente aditivo, não usado por nenhuma das 24 linhas da tabela, dá ao adapter de S05-02 um sítio para passar o consentimento herdado de uma sessão anterior, se o tiver.

O que fica em aberto, documentado em `packages/session/README.md` ("Decisão em aberto"): se a ausência de consentimento herdado deve *bloquear* a transição para `ativa` (voltar a `aguardandoConsentimento` em vez de avançar) é uma mudança de comportamento da tabela de mesa — decisão de produto/legal (dados de saúde, LGPD art. 11 / GDPR art. 9), não técnica, e por isso não decidida nesta ronda autónoma. Ticket recomendado para quem descidir isto: um ticket de S05-02 (o adapter que vai de facto adquirir microfone/GPU/disco) é o lugar natural para fechar esta decisão, porque é lá que o custo de "gravar sem consentimento comprovado" se torna real.

## Estado no cérebro (vault)

Ticket `S05-01`: `status: em-curso` → a atualizar para `pronto` (fica pendente de commit local + confirmação, ver nota abaixo).

Commit local criado nesta sessão, sem push, sem PR (regra do turno).
