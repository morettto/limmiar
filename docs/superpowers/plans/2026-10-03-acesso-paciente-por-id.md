# Acesso do paciente por ID

**Objetivo:** substituir magic link por e-mail por convite gerado a partir do prontuário da carteira autenticada; paciente tem identidade opaca e pode manter vínculos com vários profissionais.

**Contrato:** `docs/v1-criterios-de-aceite.md`, pedido do usuário em 3 de outubro. Cadastro e autenticação anônimos comprovados em 4 de outubro; pairing e compartilhamento consentido continuam em execução.

**Arquitetura:** ID de conta do paciente identifica apenas a conta pseudônima. `patientId` identifica o prontuário dentro da carteira do profissional. Vínculos são pares autorizados entre esses IDs, não autorização para ler prontuários de outros profissionais. Contatos e nomes continuam dentro dos envelopes cifrados do cliente.

## 1. Propriedade antes de gerar convite

- [x] `PatientLinkService` consulta `PatientRecordStore.GetLastSequenceAsync(professionalAccountId, patientId, cancellationToken)` após a autorização profissional. Ausência retorna `CreateInviteFailure.PatientNotFound`.
- [x] `PatientLinkEndpoints` mapeia a ausência a `404 patients.not_found`, indistinguível de ID de terceiro. Não carregar o histórico cifrado para responder existência.
- [x] Testar prontuário próprio, inexistente, pertencente a outro profissional, token de outro usuário, profissional não verificado, paciente e ausência de token em Postgres real. Ajustar fixtures de compartilhamento para criar um prontuário real antes de gerar convite.

O registro é append-only e a propriedade não é transferível. A verificação de existência usa essa invariante; caso o modelo passe a permitir remoção/transferência, a emissão deverá compor a verificação na mesma transação.

## 2. Conta pseudônima

- [x] `Accounts/Domain/Account.cs`, `PostgresAccountStore`, schema de contas e fakes: e-mail ausente para Patient, obrigatório para Professional. Remover cadastro/login de Patient por senha, Google ou e-mail. Não criar e-mail fictício.
- [x] `entities/account/{account,session,api}` aceita somente `email: null` para Patient e conserva a exigência de e-mail para Professional. Nenhuma identidade é adicionada à sessão persistida.
- [x] Gerar conta/handle opacos estáveis para WebAuthn. Nome de usuário da cerimônia é um identificador opaco, nunca nome ou contato.
- [x] Testar duas contas anônimas sem colisão, leitura por ID, autenticação profissional preservada, rejeição de formas antigas de cadastro do paciente e ausência de PII nos corpos HTTP/linhas do banco.

## 3. Convite de acesso vinculado à carteira

- [x] Emissão autenticada por `professionalAccountId` e `patientId` existente gera token aleatório de uso único, com validade, revogação e vínculo ao prontuário. Conhecer um ID não permite emitir token.
- [x] `MagicLinkIssuer`, `IMagicLinkIssuer`, `MagicLinkTicketData` e handlers usam IDs/vínculo, sem Email. Token consumido não pode ser repetido; ticket WebAuthn não pode mudar conta, profissional ou prontuário.
- [x] Primeira entrada registra passkey do paciente; reutilização confirma sua passkey existente. Novo vínculo com outro profissional exige a mesma prova de posse, não uma igualdade de IDs recebida do cliente.
- [x] Compor criação da conta e vínculo autorizado atomicamente. Falha de cadastro/resgate não deixa conta órfã nem vínculo parcial. Atualização de contador WebAuthn deve preservar alterações concorrentes.
- [x] Testar expiração, revogação, replay, concorrência, profissional revogado, token trocado entre prontuários e mesmo paciente vinculado a dois profissionais com históricos distintos.

## 4. Fluxo real do app

- [x] `PatientCare` gera/copia o link a partir do paciente selecionado; `AuthScreen` remove o formulário de e-mail do paciente. Callback de magic link usa o handle opaco, valida passkey e adota a conta pseudônima.
- [x] KEK vem da PRF por credencial WebAuthn, é importada como CryptoKey não extraível e mantida em RAM. A saída PRF é apagada; nunca vai nos corpos HTTP. Uma asserção extra obtém a PRF quando o cadastro apenas habilita a extensão. Passkey sem PRF é recusada antes de criar a conta no servidor.
- [x] `/hoje` recebe o chaveiro real. Check-in cifrado é recuperado após nova autenticação com a mesma passkey.
- [x] E2E: prontuário criado e cifrado pela interface → convite por ID → cadastro sem identidade → check-in cifrado → nova autenticação → segundo profissional → histórico de terceiro retorna 404 → convite revogado retorna 401.
- [ ] Ligar pairing real para paciente e profissional, sem chaves/tokens em query strings. Provar transferência entre dispositivos e compatibilidade com passkeys físicas/gerenciadores sincronizados.
- [ ] Produzir preferências e par de chaves de compartilhamento pela interface real. Provar que o item autorizado para um profissional não fica disponível para o segundo vínculo.

## Validação

Foco: `dotnet test apps/api/tests/Api.Tests/Api.Tests.csproj -c Release --filter FullyQualifiedName~PatientLinks -p:CollectCoverage=false --no-restore`.
Release evita substituir o executável Debug que está servindo o app local. A prova de cobertura usa depois a suíte inteira, com os thresholds existentes.

App: testes de sessão, contratos de API e fluxos de autenticação; build, lint, arquitetura e quatro catálogos completos. Navegador real com autenticador WebAuthn de teste e Postgres real. Não anunciar anonimato completo enquanto o fluxo antigo por e-mail estiver acessível.

### Resultados em 4 de outubro

- API: 814 testes, zero falhas/skips, 100% linha/ramo/método; `.local/paciente-anonimo-api-completo.log`.
- App: 1.099 testes em 116 arquivos, 100% nas quatro métricas; `.local/paciente-anonimo-app-completo.log`. Build e portões de lint/arquitetura sem erros; warnings existentes registrados. Quatro catálogos com 359 mensagens, compilação estrita aprovada.
- Navegador real + Postgres local: `.local/paciente-id.spec.ts`, `.local/paciente-id-e2e.log`, `.local/paciente-id-prova.json`. Uma passkey virtual com PRF passou cadastro e duas asserções. Check-in reabriu sem erro de cifra. Axe sem violações e sem overflow em 375px.
- Banco local: duas contas Patient, zero e-mails/verificadores de senha/Google não nulos. Constraint exige ausência desses campos; profissional continua com e-mail. Testes de banco conferem a conta criada antes de contar os campos, evitando resultado vazio enganoso.
- Limites: segunda carteira usa fixture sintética para testar propriedade por RLS; não comprova compartilhamento consentido nem precisão clínica. A passkey virtual não comprova suporte de todo dispositivo físico. Esses limites não foram ocultados para liberar a V1.

Fontes: [WebAuthn PRF](https://www.w3.org/TR/webauthn-3/#prf-extension), [explicação oficial](https://github.com/w3c/webauthn/blob/main/explainers/prf-extension.md).
