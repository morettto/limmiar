# entities/partilha

## Responsabilidade

Partilha seletiva cifrada de itens do paciente para uma profissional vinculada (S11-02, fatias
3-5): quem decidiu partilhar o quê (`partilha.ts`), o blob de preferências versionado no servidor
(`preferencias.ts`), a cifra ponto-a-ponto (`cifra.ts`), o cliente HTTP das rotas de partilha
(`api.ts`) e o único orquestrador que liga os três a um check-in (`partilhar-checkin.ts`). Não
conhece React nem UI; tudo aqui é puro ou fala só com `fetch`/`localStorage`/`@limmiar/crypto`.

## Contrato público

- `TipoPartilhavel`, `ItemPartilhado`, `EstadoPartilha`, `chaveDoVinculo`, `comPartilha`,
  `destinatarios` (`partilha.ts`) — `destinatarios` é o único lugar que decide "esta profissional
  recebe": vínculo da paciente certa, toggle ativo e chave pública conhecida.
- `cifrarItem`, `decifrarItem` (`cifra.ts`) — ECDH estático-estático X25519
  (`getSharedSecret` → `deriveChannelKey(ss, salt)` → AES-GCM), reusando só o que
  `@limmiar/crypto` já exporta.
- `enviarItemPartilhado`, `listarItensPartilhados`, `obterPreferenciasPartilha`,
  `gravarPreferenciasPartilha` (`api.ts`) — um por rota de `PatientLinks` (S11-02 §1).
- `RollbackDePreferencias`, `lerEstadoPartilha`, `definirPartilha` (`preferencias.ts`).
- `partilharCheckIn` (`partilhar-checkin.ts`) — **a única porta** de "cifrar um check-in para a
  profissional". Fail-closed, sem retentativa: falhar a ler preferências, listar vínculos ou
  enviar lança, e o chamador decide o que mostrar.

## Invariantes

- **Zero destinatários = zero cifra.** `partilharCheckIn` só chama `garantirParDeChaves`
  (que expõe a privada) depois de `destinatarios` devolver pelo menos um vínculo. Um item nunca
  partilhado nunca é cifrado com a pública de ninguém.
- **Chave por vínculo** `profissionalAccountId|vinculadoEm`: um vínculo novo (depois de
  desvincular e vincular de novo) nunca herda a partilha do anterior.
- **Salt = AAD** `limmiar/partilha/v1|<pacienteAccountId>|<profissionalAccountId>`: liga o
  envelope à direção paciente → profissional; o servidor não o consegue reapresentar noutro
  vínculo nem forjar (não tem a privada de nenhum dos dois lados).
- **Blob de preferências:** `{ versao, estado }` cifrado pela KEK da conta (AAD
  `limmiar/partilha-estado/v1|<accountId>`). A `versao` interna tem de bater com o `version` do
  fio, e nunca pode ser menor do que a última vista em `localStorage`
  (`limmiar:partilha-versao:<accountId>`, só sobe) — caso contrário `RollbackDePreferencias`. Um
  404 do servidor vale `{ versao: 0, estado: {} }`; qualquer outra falha de leitura lança
  (fail-closed, nunca finge um estado).
- **CAS otimista:** `definirPartilha` grava com `expectedVersion` = versão lida; um
  `sharing.version_conflict` relê e reaplica a mesma mudança uma única vez, um segundo conflito
  lança.
- **Sem retry na gravação do item:** a decisão de partilhar um check-in é a do momento em que ele
  foi gravado; se a partilha falhar, o check-in local não se desfaz e não há nova tentativa mais
  tarde.

## Armadilhas

- `entities/partilha` importa `Vinculo`/`listarVinculos`/`garantirParDeChaves` de
  `entities/vinculo` e `CheckIn` de `entities/checkin`. Isto viola a regra `fsd-no-cross-slice`
  de `.dependency-cruiser.cjs`, que hoje só tem exceções nomeadas para `recovery` e
  `device-pairing-new` (ambas em `features/`). `pnpm run lint:arch` falha até essa exceção ganhar
  um par simétrico para `entities/partilha` — decisão fora do âmbito deste módulo, ver o relatório
  do ticket S11-02.
- `deriveChannelKey` é o mesmo HKDF usado no emparelhamento de dispositivos
  (`device-pairing-channel.ts`); só o `salt` diferente evita que os dois protocolos derivem a
  mesma chave a partir do mesmo par de contas.
- `lerUltimaVista` conta com `Number(null) === 0`: não reintroduzir um `raw === null ? 0 : ...`
  explícito, é a mesma coisa com mais código.
