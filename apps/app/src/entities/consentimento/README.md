# entities/consentimento

## Responsabilidade

Cliente HTTP do consentimento por finalidade (spec S10, ticket S10-02, fatia 4). Sem
domínio próprio nem estado — só os tipos que espelham o fio do backend
(`Api.Consent`) e as duas chamadas que o consomem. Molde de `entities/nota/api.ts`:
mesma disciplina (`request` de `shared/api`, `ProblemResult` no caminho não-2xx),
sem `index.ts`, como `nota` também não tem.

## Fluxo principal

1. `registrarConsentimento(baseUrl, accountId, accessToken, patientId, { finalidade, decisao })`
   — `POST /accounts/{accountId}/patients/{patientId}/consents` com
   `{ purpose, decision }` no corpo. Revogar é a mesma chamada com
   `decisao: 'revogado'` — não há `DELETE` nem `PUT` (ver `ConsentEndpoints.cs`,
   fatia 3): revogar é um `INSERT` no log append-only do servidor, nunca um
   apagar. Devolve `{ ok: true, finalidade, decisao, registradoEm }` no 201, ou
   `ProblemResult` fora do 2xx (400 campo inválido, 401 sem bearer para esta conta,
   403 `consent.not_authorized_to_record`, 404 conta inexistente).
2. `obterConsentimentos(baseUrl, accountId, accessToken, patientId)` — `GET` na
   mesma rota, devolve `{ ok: true, consentimentos: { gravacao, analiseIa } }` no
   200. Cada campo é o fold do log de eventos para aquela finalidade —
   `'pendente'` sem eventos, senão a decisão do evento mais recente.

## Formato do fio (confirmado contra `ConsentEndpoints.cs`, fatia 3)

- Pedido do `POST`: `{"purpose":"gravacao"|"analiseIa","decision":"concedido"|"revogado"}`.
- Resposta do `POST` (201): `{"patientId","purpose","decision","recordedAt"}` — strings,
  não ordinais (`Enum.TryParse`/`Enum.IsDefined` no servidor, sem
  `JsonStringEnumConverter` no request para não arriscar `WarningsAsErrors` do AOT).
- Resposta do `GET` (200): `{"gravacao":"pendente"|"concedido"|"revogado","analiseIa":"..."}`
  — aqui sim strings via `JsonStringEnumConverter<ConsentStatus>` registado só para
  este tipo de resposta (ver `ConsentComposition.cs`).

## Pontos de entrada

- `Finalidade` = `'gravacao' | 'analiseIa'`, `Decisao` = `'concedido' | 'revogado'`,
  `EstadoConsentimento` = `'pendente' | 'concedido' | 'revogado'` (tipos).
- `ConsentimentosDoPaciente` — `{ gravacao: EstadoConsentimento; analiseIa: EstadoConsentimento }`.
- `registrarConsentimento(baseUrl, accountId, accessToken, patientId, { finalidade, decisao }): Promise<RegistrarConsentimentoResult>`
- `obterConsentimentos(baseUrl, accountId, accessToken, patientId): Promise<ObterConsentimentosResult>`
- `EstadoConsentimento` é o tipo que `features/live-session/microfone.ts` importa
  para decidir se abre o microfone — é o único consumidor hoje do lado da
  gravação; `analiseIa` ainda não tem consumidor (fica para a S07, ver decisão
  abaixo).

## Decisões desta fatia

- **Sem UI e sem estado global**: tudo entra e sai por parâmetro/retorno, mesmo
  padrão de `entities/nota` e `entities/patient`. Nenhum componente React lê este
  módulo diretamente nesta fatia (decisão 6 do desenho do ticket — zero UI). A
  única exceção, na fatia 6, é o andaime de e2e `/e2e/microfone`
  (`app/routing/router.tsx`, atrás de `VITE_ENABLE_E2E_TEST_ROUTES`): importa só
  o tipo `EstadoConsentimento` para tipar a query string, não chama nenhuma
  função deste módulo — o estado de consentimento chega por parâmetro fixo do
  URL, não de `obterConsentimentos`. Não é rota de produção (ver
  `features/live-session/README.md`, secção "Prova em browser real").
- **Portão do copiloto para `AnaliseIa` fica fora de âmbito.** Este módulo expõe a
  finalidade e torna-a revogável; ligar `AnaliseIa` a um portão real (ex.: recusar
  chamar o copiloto sem consentimento) é trabalho da S07, não desta fatia.
