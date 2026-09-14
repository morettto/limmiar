# entities/vinculo

## Responsabilidade

Cliente HTTP do vínculo profissional-paciente e do par de chaves X25519 estático da conta
(`api.ts`), e a única porta para a privada desse par no dispositivo (`par-de-chaves.ts`). Não
conhece React nem UI.

## Contrato público

- `ParDeChavesSelado`, `Vinculo` (tipos de domínio; bytes como `Uint8Array`, base64 só no fio).
- `publicarParDeChaves`, `obterParDeChaves`, `criarConviteVinculo`, `resgatarConviteVinculo`,
  `listarVinculos`, `desvincular` (`api.ts`) -- um por rota da tabela do S11-04.
- `garantirParDeChaves(p: { baseUrl, accountId, accessToken, kek }): Promise<{ publicKey,
  privateKey }>` (`par-de-chaves.ts`) -- idempotente: lê o par publicado, ou gera, sela e publica
  um novo na primeira vez que falta. É a **única** função deste módulo que devolve a privada em
  claro; nenhuma outra exportação a expõe.

## Invariantes

- A privada só existe em memória, nunca em `localStorage`/`IndexedDB` -- ao contrário de
  `entities/checkin`, este módulo não tem store local.
- AAD fixo `limmiar/chave-x25519/v1|<accountId>`, reusado para embrulhar a DEK e selar a privada
  (ADR-S11-06).
- `garantirParDeChaves` nunca manda a privada em claro por rede: só `sealedPrivateKey` (cifrada)
  viaja em `publicarParDeChaves`.
- GET 404 (`key_pair.not_found`) gera e publica um par novo; PUT 409
  (`key_pair.public_key_conflict`) descarta o gerado localmente e adota o do servidor -- dois
  dispositivos em corrida convergem para o mesmo par.

## Armadilhas

- Qualquer código de erro fora de `key_pair.not_found`/`key_pair.public_key_conflict` faz
  `garantirParDeChaves` lançar em vez de gerar um par -- 401/403 significam sessão ou conta
  erradas, não ausência de par.
