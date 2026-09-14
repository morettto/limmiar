# S09-03 · Forma — um só helper de autorização por conta devolve o problema

Worktree `C:/wt-S09-01`, branch `feat/S09-01-painel-profissional`, base `045d417`.
Inventário do scout em 2026-09-10 (caminhos relativos a `apps/api/src/Api/Features/`).

## 1. O seam

```csharp
// Accounts/Sessions/Application/Ports/SessionTokenIssuerAuthorization.cs
public static class SessionTokenIssuerAuthorization
{
    // null = autorizado; 401 = header ausente, sem "Bearer ", ou token inválido; 403 = token válido de outra conta
    public static JsonHttpResult<LimmiarProblemDetails>? AccountAccessProblem(
        string? authorizationHeader, Guid accountId, ISessionTokenIssuer sessionTokenIssuer);
}
```

- Corpo: o mesmo parse de hoje em `AuthorizeForAccount`, com os retornos trocados por
  `AccessTokenUnauthorizedProblem()` e `ForbiddenProblem()` (`Accounts/AccountsProblemResults.cs:10,16`,
  `internal`, mesmo assembly, sem inversão de dependência).
- Apagam-se `IsAuthorizedForAccount`, `AuthorizeForAccount` e o enum `AccountAuthorizationOutcome`.
- Idioma único nos handlers:

```csharp
if (AccountAccessProblem(authorization, accountId, sessionTokenIssuer) is { } accessProblem)
{
    return accessProblem;
}
```

Todos os 20 handlers já devolvem `Results<…, JsonHttpResult<LimmiarProblemDetails>>`, logo o 403 cabe sem mexer em assinaturas.

## 2. Call-sites (20 handlers)

| Ficheiro | Linhas | Handlers |
|---|---|---|
| `Scheduling/SchedulingEndpoints.cs` | 70, 98, 123, 143-149 | Schedule, Move, Cancel, List (o `switch` sai) |
| `Patients/PatientEndpoints.cs` | 62, 95, 122, 148 | Create, AppendEntry, Get, List |
| `Notes/NoteEndpoints.cs` | 45, 76 | Sign, Get |
| `Consent/ConsentEndpoints.cs` | 42, 73 | Record, Get |
| `Accounts/ProfessionalVerification/Presentation/ProfessionalVerificationEndpoints.cs` | 53 | Submit |
| `Accounts/DevicePairing/Presentation/DevicePairingEndpoints.cs` | 63, 95, 118 | Create, GetClaimStatus, SubmitPayload |
| `Accounts/Recovery/Presentation/RecoveryEndpoints.cs` | 63 | RegisterRecoveryVerifier |
| `Accounts/VoiceEnrollment/Presentation/VoiceEnrollmentEndpoints.cs` | 49, 80, 101 | Put, Get, Delete |

`ficheiros_previstos` do ticket só listava os quatro primeiros; os quatro de `Accounts/*` entram por
força do critério 1 e do critério 3 (o símbolo deixa de existir).

## 3. Metadados OpenAPI

Declaram já 401 + 403: Scheduling (4), Patients (4), Notes POST, Consent (2).
Falta o 403, a acrescentar com a mesma forma que os vizinhos já usam: Notes GET, DevicePairing (3),
VoiceEnrollment (3), ProfessionalVerification POST, Recovery. O `WithDescription` de
`VoiceEnrollmentEndpoints.cs:18` cita `EndpointHelpers.IsAuthorizedForAccount`: passa a citar o helper novo.

## 4. Testes (seam: integração HTTP, `WebApplicationFactory` já existente)

Viram de 401 para 403 com `auth.forbidden`, renomeados `…Returns403WithProblemDetails`:

- `Patients/PatientEndpointsTests.cs:345` `PostPatient_WithValidTokenForDifferentAccount_Returns401WithProblemDetails`
- `Auth/ProfessionalVerificationEndpointsTests.cs:219` `PostSubmit_WithAccessTokenForAnotherAccount_Returns401WithProblemDetails`
- `Auth/RecoveryEndpointsTests.cs:79` `PostAccountRecoveryPhrase_WithAccessTokenForAnotherAccount_Returns401WithProblemDetails`
- `Auth/DevicePairingEndpointsTests.cs:73` `PostPairingSession_ForAnotherAccountId_Returns401`
- `Notes/NoteEndpointsTests.cs:105` `PostNoteSignature_WithValidTokenForDifferentAccount_Returns401WithProblemDetails`

Novos, um por ficheiro sem teste de conta alheia: `Consent/ConsentEndpointsTests.cs`,
`Accounts/VoiceEnrollmentEndpointsTests.cs`, e um verbo de escrita em `Scheduling/SchedulingEndpointsTests.cs`
(o 403 do GET em `:730` fica como está). Os testes de 401 existentes (sem header, sem `Bearer`, token
inválido) ficam intactos e cobrem os dois ramos 401 do helper.

## 5. Fatias TDD (vermelho → verde, uma de cada vez)

1. Flip do teste de Patients (vermelho). Verde: criar `AccountAccessProblem` e migrar os 4 handlers de Patients.
2. Notes, Consent, Scheduling (escrita + o `switch` do List), um par vermelho/verde por ficheiro.
3. ProfessionalVerification, DevicePairing, Recovery, VoiceEnrollment, um par por ficheiro.
4. Sem teste novo: apagar `IsAuthorizedForAccount`, `AuthorizeForAccount` e o enum; o build prova que não sobra chamador.

## 6. Documentação

- `Accounts/Sessions/README.md:22-43`: descreve só o contrato 401 vs 403 do helper, sem lista de chamadores nem histórico de tickets (absorve a nota 4 do thermo).
- `Scheduling/README.md:50-61`: deixa de dizer que o GET é o único que separa 401/403.
- `Consent/README.md:144`: trocar o nome do helper.
- Comentário do helper: duas linhas no máximo (`no-long-comments` já partiu o lint uma vez).

## 7. Compatibilidade

O front não distingue 401 de 403 (`apps/app/src/shared/api/client.ts:13-24` trata todo o não-2xx em
`readProblem()`, sem refresh-on-401). Os testes de front que já assertam 403 (`entities/agenda/api.test.ts:53-56`,
`entities/consentimento/api.test.ts:38-47`) continuam válidos. Nenhuma mudança no app.

## 8. Rota de construção

`implementer` (sonnet) com `migration` (mudança de contrato de API: status de conta alheia passa de 401 a 403)
+ `tdd` + `ponytail`. Revisores da etapa 7: `reviewer-lang` com `review-dotnet-csharp`, `reviewer-spec`, `reviewer-lean`.
