# entities/checkin

## Responsabilidade

Dado, cifra e série do check-in diário do paciente (sono, ansiedade, frase opcional). Não conhece
React nem UI; `checkin.ts` é puro, `checkin-store.ts` só fala com `localStorage` e `@limmiar/crypto`.

## Contrato público

- `Nivel` (`1 | 2 | 3 | 4 | 5`), `DiaLocal` (`'YYYY-MM-DD'`), `CheckIn` (`checkin.ts`).
- `diaLocal(agora: Date): DiaLocal` -- dia local do dispositivo, nunca UTC.
- `serieComLacunas(checkins, ate, dias)` -- `dias` entradas da mais antiga à mais recente (`ate` é
  a última); dia sem check-in vira `{ checkin: null }`, nunca interpolado.
- `guardarCheckIn(kek, accountId, checkin): Promise<void>` e `lerCheckIns(kek, accountId):
  Promise<CheckIn[]>` (`[]` se nada gravado) -- `checkin-store.ts`.

## Invariantes

- Nenhum check-in é gravado em claro (ticket S11-01): um único envelope AES-GCM por conta guarda o
  array inteiro, DEK nova a cada `guardarCheckIn`. As datas também são dado do paciente, por isso
  não há um envelope por dia.
- AAD fixo `limmiar/checkin/v1|<accountId>`, reusado para embrulhar a DEK e cifrar o array -- ao
  contrário de `copilot-byok`, que separa AAD de DEK e de dado; aqui um único envelope não precisa
  de dois.
- `guardarCheckIn`/`lerCheckIns` rejeitam `accountId === ''` (mesma guarda de
  `features/copilot-byok/key-store.ts`).
- Um check-in no mesmo `dia` substitui o anterior; dias diferentes acumulam no mesmo array.
- Nenhum pedido de rede transporta o check-in (ticket S11-01) -- tudo fica em `localStorage`.

## Armadilhas

- `diaLocal` usa `getFullYear`/`getMonth`/`getDate` (campos locais). `toISOString()` (UTC) dá o dia
  errado perto da meia-noite local -- não trocar.
- ADR-S11-05 (apagar check-ins no logout) está por decidir: `checkin-store.ts` **não** está na
  lista `PURGAS` de `app/providers/purgar-conta.ts`. Não adicionar sem essa decisão.
