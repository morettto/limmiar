# ADR-0010 · minisearch fica em intervalo, o lockfile é o pin

- Status: aceite
- Data: 2026-09-03
- Revisão: 2027-03-03
- Ticket: S08-17

## Contexto

`apps/app/src/features/nota-biblioteca` constrói o índice de busca da biblioteca com
`minisearch`, declarado em `apps/app/package.json` como `"minisearch": "^7.2.0"` — a única
dependência de produção do repositório cujo código corre sobre texto de nota **já decifrado**.
Toda a restante criptografia de S08 (`selarIndice`/`abrirIndice`) é código do repositório; o
`minisearch` é o terceiro que vê o plaintext clínico.

`apps/app/package.json` já tem cinco versões exatas, todas em `devDependencies`:
`@stryker-mutator/core@9.6.1`, `@stryker-mutator/vitest-runner@9.6.1`,
`@vitest/coverage-istanbul@4.1.10`, `@vitest/web-worker@4.1.10` e `vitest@4.1.10`. O ticket
S08-17 nasceu da leitura de que o `^` do `minisearch` era uma omissão dessa mesma prática. O
critério 1 do ticket não fecha o ramo: pede "decisão registada: fixar a versão exata, **ou**
manter o intervalo com o motivo escrito". Este ADR é o motivo escrito do segundo ramo.

## Decisão

O intervalo `^7.2.0` fica. Não se fixa a versão exata do `minisearch` em `package.json`.

Em troca, `minisearch` sai do lote do passe de dependências: quando for revisto, é **item
próprio, com changelog lido, mesmo numa patch**. A regra vive em `AGENTS.md`, escrita por
critério e não por nome, com `minisearch` como o único membro de hoje; a condição está escrita
só lá, para não haver duas versões dela.

## Porquê

- **O pin já existe, uma camada abaixo.** `pnpm-lock.yaml` está versionado e fixa
  `minisearch@7.2.0` com integridade. Os 16 `pnpm install` dos workflows correm todos
  `--frozen-lockfile`. Numa instalação limpa, de CI ou de máquina nova, o `^` nunca resolve
  para outra coisa: só se move num `pnpm update` deliberado — que é exatamente o momento em
  que o passe de dependências olha para a lib.
- **Um segundo pin é uma segunda fonte de verdade.** Fixar `7.2.0` no `package.json` faria o
  manifesto repetir o que o lockfile já diz, com o custo de poder divergir dele em silêncio
  (um `pnpm update minisearch` que mexe no lock e não no manifesto, ou o inverso). Duas
  escritas do mesmo facto é o modo de falha, não a proteção.
- **O risco real não era a resolução, era o lote.** A preocupação legítima do ticket é que
  uma patch da lib que lê plaintext clínico passe num batch de vinte upgrades sem ninguém ler
  o changelog. Isso é um problema de processo do passe de dependências, e é onde ficou a
  correção — não no operador de intervalo, que não teria impedido nada disso.
- **Os cinco pins exatos não são o mesmo caso.** São ferramentas de teste e mutação, onde a
  versão exata compra reprodutibilidade de números de cobertura entre máquinas. Nenhuma delas
  entra no bundle nem toca dados de utilizador.

## Consequências

- `apps/app/package.json` e `pnpm-lock.yaml` não mudam neste ticket. O diff de S08-17 é
  documentação e a regra em `AGENTS.md`.
- `/build:deps` tem de tratar `minisearch` fora do agrupamento. Um agente que agrupe por
  hábito viola `AGENTS.md`, que é carregado em toda a tarefa.

## Revisão

Seis meses. O que a data guarda não é a versão — o passe semanal já levanta o `minisearch`
sozinho assim que sair uma nova, precisamente por não poder ser agrupado. Guarda a **premissa**
em que a decisão assenta: lockfile versionado e `--frozen-lockfile` em todo o CI. Se essa
premissa cair (um workflow que instale sem lockfile, um migração de gestor de pacotes, um
consumidor que instale o pacote a partir do manifesto), o `^` deixa de ser inerte e a decisão
inverte-se.

A premissa muda ao ritmo da configuração de CI, não ao das releases da lib, e seis meses é o
horizonte em que a etapa 5 do `/build:deps` diz que já ninguém distingue "velha por decisão"
de "velha por esquecimento". Se na data de revisão do cabeçalho a premissa se mantiver, a
revisão é ler dois ficheiros e renovar essa data.
