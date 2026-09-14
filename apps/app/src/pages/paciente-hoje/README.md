# pages/paciente-hoje

## Responsabilidade

O ecrã "Hoje: como você está agora?" -- o formulário de check-in diário (sono, ansiedade, frase
opcional) e a série de 7 dias, dentro do layout `paciente` (que já fornece `ContactoEmergencia`).

## Contrato público

- `PacienteHojePage({ accountId, kek, agora? })` -- `accountId`/`kek` `null` mostra o estado
  bloqueado, sem formulário nem leitura; `agora` (default `new Date()`) é o seam de teste para o
  dia de hoje.

## Invariantes

- Check-in completo em exatamente 3 toques (ticket S11-01, critério de aceite): 1 rádio de sono,
  1 rádio de ansiedade, 1 clique em "Guardar". A frase fica fora da contagem.
- Dia sem check-in aparece como lacuna na série (`entities/checkin/serieComLacunas`), nunca
  interpolado nem escondido.
- Nenhum pedido de rede sai daqui: `guardarCheckIn`/`lerCheckIns` só tocam `localStorage`.
- `kek === null` (chaveiro bloqueado, sem `KeychainProvider` ainda) é o estado real de produção
  hoje -- mesmo precedente de `CopilotKeyPage`/`NotaPage`. O caminho de 3 toques só é exercido em
  E2E (`/e2e/paciente-hoje`, `app/routing/E2ePacienteHojeScaffold.tsx`).

## Armadilhas

- O `useEffect` que carrega a série e o `guardar()` que grava usam a mesma flag `cancelado` para
  não atualizar estado depois de desmontar -- omitir isso derruba o teste de unmount-antes-do-
  resolve, não só um lint de "memory leak" teórico.
