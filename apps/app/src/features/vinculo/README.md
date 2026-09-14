# features/vinculo

## Responsabilidade

Os três ecrãs do vínculo profissional-paciente: gerar o código de convite (lado profissional),
resgatá-lo (lado paciente), e desvincular (partilhado pelos dois papéis).

## Contrato público

- `GerarConviteVinculo` (`baseUrl, accountId, accessToken, kek, patientId`) -- ao montar, chama
  `garantirParDeChaves`; o botão "Gerar código de vínculo" chama `criarConviteVinculo` e mostra o
  código com a validade.
- `ResgatarConviteVinculo` (`baseUrl, accountId, accessToken, kek, onVinculada?`) -- mesma garantia
  ao montar; o campo "Código de vínculo" + botão "Vincular" chamam `resgatarConviteVinculo` e
  mostram "Vinculada." no sucesso.
- `DesvincularVinculo` (`baseUrl, accountId, accessToken`) -- único componente para os dois
  papéis: lista `listarVinculos` e chama `desvincular` por item; recarrega a lista no sucesso.

## Invariantes

- Nenhum dos três monta em rota de produção: não existe `KeychainProvider` ainda (mesmo
  `ponytail:` de `CopilotKeyPage`/`NotaPage`/`/hoje`, `router.tsx`). Só alcançáveis por
  `E2eVinculoScaffold` atrás de `VITE_ENABLE_E2E_TEST_ROUTES`.
- `link.invite_not_found` (código inválido, expirado ou já usado) mostra sempre "Código inválido
  ou expirado." -- não distingue os três casos (Specs S11, Cenário E2E, passos 9-10). Vem direto
  do catálogo de `shared/api/problem-messages.ts` via `translateProblemCode`, não de um caso
  especial local: `link.invite_not_found`, `auth.forbidden` e os demais `key_pair.*`/`link.*`
  ganharam mensagem própria no catálogo no S11-04 (antes não existiam em `problem-codes.ts`, e
  qualquer código ali ausente cai no genérico "Ocorreu um erro inesperado.").
- `garantirParDeChaves` falhar ao montar não bloqueia o ecrã: só fica registada em
  `console.error`, porque gerar convite/resgatar não depende da pública já estar publicada.

## Armadilhas

- O "outro lado" do vínculo em `DesvincularVinculo` é sempre o account id que não é o
  `accountId` da prop -- funciona para as duas contas do mesmo vínculo sem saber o papel.
