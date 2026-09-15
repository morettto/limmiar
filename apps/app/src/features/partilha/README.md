# features/partilha

## Responsabilidade

O orquestrador que liga `entities/partilha` (estado, blob de preferências, cifra), `entities/
vinculo` (`Vinculo`, `listarVinculos`, `garantirParDeChaves`) e `entities/checkin` (`CheckIn`):
decide o que é partilhável, para quem, e cifra um check-in para cada destinatária. É o único lugar
que conhece as três entidades ao mesmo tempo -- `entities/partilha` fica cega a `Vinculo`/`CheckIn`
de propósito (ver `entities/partilha/README.md`).

## Contrato público

- `ItemPartilhado` (`partilha.ts`) -- `{ tipo: 'checkin'; checkin: CheckIn }`, o payload concreto
  que `cifrarItem`/`decifrarItem` (opacos em `entities/partilha/cifra.ts`) veem como `unknown`.
- `chaveDoVinculo(v: Vinculo): string` (`partilha.ts`) -- `${profissionalAccountId}|${vinculadoEm}`:
  um vínculo novo (depois de desvincular e vincular de novo) nunca herda a chave de um antigo. É a
  única função que sabe transformar um `Vinculo` na chave opaca que `entities/partilha` usa.
- `destinatarios(estado, vinculos, pacienteAccountId, tipo): Vinculo[]` (`partilha.ts`) -- o único
  lugar que decide "esta profissional recebe": vínculo da paciente certa, toggle ativo
  (`estado[chaveDoVinculo(v)]?.[tipo] === true`) e chave pública conhecida.
- `partilharCheckIn(p: { baseUrl; accountId; accessToken; kek; checkin }): Promise<{ partilhadoCom:
  string[] }>` (`partilhar-checkin.ts`) -- **a única porta** de "cifrar um check-in para a
  profissional". Fail-closed, sem retentativa: falhar a ler preferências, listar vínculos ou
  enviar lança, e o chamador decide o que mostrar.
- `PartilhaCheckIns` (`PartilhaCheckIns.tsx`, S11-02 fatia 6) -- ecrã da **paciente**: um checkbox
  por vínculo em que ela é a paciente ("Compartilhar check-ins com esta profissional"), ligado a
  `lerEstadoPartilha`/`definirPartilha` de `entities/partilha/preferencias.ts` via
  `chaveDoVinculo`. Props `{ baseUrl; accountId; accessToken; kek }`.
- `CheckInsPartilhados` (`CheckInsPartilhados.tsx`, S11-02 fatia 6) -- ecrã da **profissional**: um
  grupo por vínculo em que ela é a profissional, com os check-ins que a paciente partilhou,
  decifrados no dispositivo (`garantirParDeChaves` + `decifrarItem`). Props `{ baseUrl; accountId;
  accessToken; kek }`. Nenhum dos dois ecrãs tem montagem de produção ainda -- sem
  `KeychainProvider`, só alcançáveis por `/e2e/partilha` (`app/routing/E2ePartilhaScaffold.tsx`).

## Invariantes

- **Zero destinatários = zero cifra.** `partilharCheckIn` só chama `garantirParDeChaves` (que
  expõe a privada) depois de `destinatarios` devolver pelo menos um vínculo. Um item nunca
  partilhado nunca é cifrado com a pública de ninguém.
- **Sem retry na gravação do item:** a decisão de partilhar um check-in é a do momento em que ele
  foi gravado; se a partilha falhar, o check-in local não se desfaz e não há nova tentativa mais
  tarde.
- `destinatarios` só devolve vínculos com `chavePublicaDoPar !== null`: sem a pública da
  profissional, `cifrarItem` não tem para quem cifrar.
- **Fail-closed no tipo do envelope.** `CheckInsPartilhados` verifica `decifrado.tipo === 'checkin'`
  antes de ler `.checkin` -- `decifrarItem` devolve `unknown`, e um envelope cujo formato coincida
  por acidente com `CheckIn` mas tenha outro `tipo` nunca deve ser tratado como um check-in de
  verdade (S11-02, review round-1).
- **Texto da revogação é invariante, não estilo.** Quando o toggle de `PartilhaCheckIns` fica
  desativado, o texto (`role="status"`) tem de dizer as duas coisas: o que muda (nada novo
  partilhado a partir de agora) e o que não muda (o que já foi partilhado continua com a
  profissional, que pode já tê-lo lido, e a Limmiar não consegue apagá-lo). Reduzir isso a "Parou
  de compartilhar." prometeria um apagamento que o sistema não faz.

## Armadilhas

- `chaveDoVinculo` tem de ser a mesma função dos dois lados (quem grava o toggle em
  `definirPartilha` e quem lê em `destinatarios`) -- nunca recalcular a chave inline, ou um vínculo
  novo pode herdar silenciosamente a partilha do anterior.
- `partilharCheckIn` importa de `entities/partilha`, `entities/vinculo` e `entities/checkin` só
  porque está em `features/`: mover qualquer parte disto de volta para `entities/partilha` reabre
  a violação `fsd-no-cross-slice` que motivou o S11-02 (refactor lint:arch).
