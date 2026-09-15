# entities/partilha

## Responsabilidade

Partilha seletiva cifrada de itens do paciente para uma profissional vinculada (S11-02): o estado
puro de quem partilha o quê, indexado por uma chave opaca (`partilha.ts`), o blob de preferências
versionado no servidor (`preferencias.ts`), a cifra ponto-a-ponto sobre um payload opaco
(`cifra.ts`) e o cliente HTTP das rotas de partilha (`api.ts`). Não conhece `Vinculo`, `CheckIn`
nem qualquer outra entidade — quem decide "o que é partilhável" e "para quem" é
`features/partilha` (o orquestrador `partilharCheckIn` vive lá). Não conhece React nem UI; tudo
aqui é puro ou fala só com `fetch`/`localStorage`/`@limmiar/crypto`.

## Contrato público

- `TipoPartilhavel`, `EstadoPartilha`, `comPartilha(estado, chave, tipo, ativa)` (`partilha.ts`) —
  `chave` é uma string opaca (quem a calcula é `features/partilha`); este módulo só liga/desliga o
  `tipo` para essa chave, sem saber o que ela representa.
- `cifrarItem({ ..., item: unknown })`, `decifrarItem(...): unknown` (`cifra.ts`) — ECDH
  estático-estático X25519 (`getSharedSecret` → `deriveChannelKey(ss, salt)` → AES-GCM), reusando
  só o que `@limmiar/crypto` já exporta; o payload é opaco (serializado com `JSON.stringify`),
  quem sabe a forma do item é o chamador.
- `enviarItemPartilhado`, `listarItensPartilhados`, `obterPreferenciasPartilha`,
  `gravarPreferenciasPartilha` (`api.ts`) — um por rota de `PatientLinks` (S11-02 §1).
- `RollbackDePreferencias`, `lerEstadoPartilha`, `definirPartilha(p: { ...; chave; tipo; ativa })`
  (`preferencias.ts`).

## Invariantes

- **Chave opaca.** `comPartilha`/`definirPartilha` recebem `chave: string` já pronta; este módulo
  nunca deriva a chave a partir de um vínculo — isso pertence a `features/partilha`
  (`chaveDoVinculo`), que é quem conhece `Vinculo`.
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

## Armadilhas

- `deriveChannelKey` é o mesmo HKDF usado no emparelhamento de dispositivos
  (`device-pairing-channel.ts`); só o `salt` diferente evita que os dois protocolos derivem a
  mesma chave a partir do mesmo par de contas.
- `lerUltimaVista` conta com `Number(null) === 0` para "nunca gravado": não reintroduzir um
  `raw === null ? 0 : ...` explícito, é a mesma coisa com mais código. Um valor corrompido em
  `localStorage` (não numérico) também cai em 0 via `Number.isFinite` (S11-02): TOFU deliberado,
  não uma tentativa de recuperar o valor real -- o pior caso é uma releitura do servidor, não um
  rollback silencioso.
- `comPartilha` substitui o registo inteiro da chave (`{ [tipo]: true }` ou `{}`) em vez de copiar
  o anterior e ligar/desligar um campo (S11-02): com um só `TipoPartilhavel` as duas formas são
  indistinguíveis, e a cópia do registo anterior era código morto (sobrevivia a mutação). Ao
  nascer um segundo `TipoPartilhavel`, voltar a copiar o registo anterior antes de ligar/desligar
  o campo — e testar que o outro tipo sobrevive à chamada.
