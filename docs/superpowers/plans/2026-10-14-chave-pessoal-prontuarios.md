# Chave pessoal dos prontuários — Implementation Plan

> **For agentic workers:** Execute inline, task by task, preserving unrelated working-tree changes. Steps use checkbox syntax.

**Goal:** Separar autenticação do desbloqueio clínico, com chave pessoal exibida uma vez e recuperação exclusivamente por códigos secretos.

**Architecture:** O navegador gera uma chave mestra aleatória de 256 bits e uma chave pessoal independente de 256 bits. AES-256-GCM sela a mestra sob a chave pessoal e sob três códigos de recuperação independentes. O servidor persiste somente envelopes, identificadores públicos e hashes dos verificadores de recuperação. Recuperar exige sessão autenticada e um código válido; substitui atomicamente todos os envelopes e códigos, preservando a mestra e os prontuários.

**Tech Stack:** Web Crypto, AES-GCM e HKDF-SHA256; React/Lingui; ASP.NET/Npgsql/PostgreSQL com RLS. Sem dependências novas.

**Spec:** Requisitos do usuário nesta conversa: exibição única, separação do login, segredo desconhecido do backend, execução em memória, códigos entregues no cadastro, perda definitiva sem chave/códigos. Este documento registra a especificação completa abaixo.

## Global Constraints

- Nunca enviar chave pessoal, código de recuperação ou mestra ao backend.
- Nunca persistir segredos em localStorage, sessionStorage, IndexedDB, URL ou telemetria.
- Identificadores de conta/slot/revisão integram o AAD. HKDF separa desbloqueio, recuperação e verificador.
- A chave em uso é `CryptoKey` não extraível; buffers temporários são zerados. JavaScript não garante apagar strings ou handles imediatamente da RAM.
- Login, Google e recuperação da conta não desbloqueiam prontuários.
- Três códigos de recuperação aleatórios; qualquer um autoriza emitir uma nova chave e novos códigos. Todos os antigos são invalidados juntos.
- Sem chave e sem códigos, o suporte não recupera dados. O login pode autenticar, mas não libera o conteúdo protegido.
- Sem compatibilidade/migração das cifras derivadas de senha. Reset só da base local identificada, se necessária; nunca do acervo científico ou de outra base.
- Não prometer revogação de cópias antigas de envelopes já baixadas ou de sessões já desbloqueadas. Recuperação por perda não resolve exfiltração da mestra.

## Pesquisa e decisão

- [Cryptomator Hub](https://docs.cryptomator.org/security/hub/): autenticação separada da gestão de chaves e envelopes opacos no servidor.
- [Cryptomator cryptolib](https://github.com/cryptomator/cryptolib/blob/develop/src/main/java/org/cryptomator/cryptolib/common/MasterkeyFileAccess.java): a chave de acesso protege a chave mestra; trocar o acesso não exige recifrar cada arquivo.
- [Bitwarden](https://bitwarden.com/help/security-faqs/): chave de uso em memória durante o desbloqueio.
- Escolha específica deste produto: chave aleatória, sem senha humana/KDF de senha, exibida só uma vez. Códigos são segredos de recuperação; não são passkeys WebAuthn nem códigos TOTP.

## Task 1: Criptografia e contratos

**Files:** criar `apps/app/src/entities/clinical-vault/{crypto,api}.ts` e testes `crypto.test.ts`, `api.test.ts`.

**Interfaces:** `createVault(accountId)` retorna documento cifrado e segredos para a tela única; `unlockVault(accountId, secret, document)` retorna KEK não extraível; `recoverVault(accountId, code, document)` emite novos envelopes/segredos e prova derivada de recuperação.

- [x] Testar abertura de prontuário real, conta errada, chave errada, cifra adulterada, recuperação e invalidação dos segredos antigos contra o novo documento.
- [x] Implementar HKDF-SHA256 com domínio e conta; AES-GCM com nonce gerado internamente; validação estrita de versão e tamanho.
- [x] Verificar que nenhum segredo ou mestra aparece no documento serializado.

## Task 2: Persistência autenticada e recuperação atômica

**Files:** criar `apps/api/src/Api/Features/Accounts/ClinicalVault/`, schema `0019_clinical_vaults.sql`, testes em `apps/api/tests/Api.Tests/Accounts/ClinicalVaultEndpointsTests.cs`; registrar em `AccountsComposition.cs` e `AccountsJsonContext.cs`.

**Interfaces:** GET/POST `/accounts/{accountId}/clinical-vault`; POST `/accounts/{accountId}/clinical-vault/recover`. Criação vence uma vez; recuperação usa revisão esperada e verificador do slot.

- [x] Testar autenticação, isolamento 403/RLS, validação, conflito de criação, recuperação com código inválido e disputa de revisão.
- [x] Guardar SHA256 do verificador derivado, nunca retorná-lo no GET; comparar em tempo constante.
- [x] Persistir substituição com `UPDATE ... WHERE revision = @expectedRevision`; nenhum endpoint revela ou substitui livremente a mestra.

## Task 3: Fluxo profissional de criação, desbloqueio e recuperação

**Files:** criar `apps/app/src/features/clinical-vault/ClinicalVaultGate.tsx` e CSS/testes; compor no router; alterar `AuthScreen.tsx`, `SessionProvider.tsx`, `AppShell.tsx` e respectivos testes.

- [x] Primeiro acesso autenticado mostra introdução e ação explícita de gerar.
- [x] Mostrar chave e códigos uma vez, permitir copiar/baixar kit mediante ação explícita, exigir confirmação guardada antes de salvar e abrir.
- [x] Próximos acessos mostram campo de chave, alternativa recuperar e saída. Estado remoto indisponível nunca vira convite para gerar novamente.
- [x] Recuperação não abre automaticamente: mostra nova chave/códigos e exige guardar antes da substituição atômica.
- [x] Bloquear desmonta conteúdo clínico e limpa handles; logout, troca de conta e recarga exigem novo desbloqueio. Pareamento não pode contornar a exigência da chave/códigos.
- [x] Acessibilidade: labels, foco inicial por etapa, mensagens de erro/status, estado ocupado, proteção contra submissão dupla, layout estreito sem overflow.

## Task 4: Remover acoplamento antigo e provar ponta a ponta

**Files:** `entities/account/account-keys.ts`, recovery clínico antigo, exports, rotas e fixtures dependentes; documentação e catálogos Lingui.

- [x] Remover derivação de KEK pela senha de login e envelopes clínicos da recuperação de conta; preservar autenticação e segundo fator.
- [x] Exigir chave pessoal também nos caminhos alternativos e atualizar fixtures quebradas pela mudança intencional.
- [x] Rodar testes de crypto, gate, auth, provider, router e API; tipagem, arquitetura, lint, traduções e build.
- [x] Provar em navegador com dados sintéticos: cadastro, chave única, reload bloqueado, senha sem acesso, código recuperando dados e segredos antigos recusados.
- [x] Identificar base local antes de reset; registrar exatamente o que foi removido ou a indisponibilidade do ambiente.

## Ameaças e limites

Credencial de login roubada não decifra os envelopes. Chave/código roubado exige também obter as cifras, mas concede acesso criptográfico. Backend comprometido pode negar serviço, adulterar envelopes (GCM rejeita) ou servir JavaScript malicioso; uma aplicação web não protege contra o próprio cliente adulterado. XSS/dispositivo comprometido durante desbloqueio pode capturar texto/segredos. Recuperação invalida o documento corrente, mas não apaga cópias já exfiltradas. Backup externo do kit é responsabilidade explícita do profissional.

## Resultado desta execução

- Criptografia, fluxo de telas, bloqueio, recuperação, contratos HTTP e remoção do acoplamento antigo implementados.
- Testes focados do app passaram; 96 testes da API passaram, incluindo PostgreSQL real, autenticação, RLS e concorrência. Builds do app e da API, tipagem, arquitetura e catálogos passaram.
- Chromium provou preservação do paciente cifrado, bloqueio ao recarregar, códigos antigos recusados, kit baixável e ausência dos segredos nas requisições/storage. Axe sem violações em introdução desktop e kit mobile. Persistência HTTP simulada na prova visual. Mais quatro E2Es passaram com API e PostgreSQL reais, incluindo nota assinada após recuperação do login e paciente após recuperação clínica.
- Revisão independente identificou uma corrida com renovação de tokens; corrigida e coberta por teste. Segunda revisão estática sem pendências críticas.
- PostgreSQL: o Docker respondeu na verificação final; 96 testes da API passaram, incluindo RLS, CAS, códigos consumidos e proteção contra dados antigos. Reset local realizado e esquema recriado, com contagens finais 0/0/0 (contas/entradas/cofres). Acervo científico preservado.
- Não foram executados os gates completos de cobertura de 100%/mutação nem todo o E2E integrado. Não houve deploy ou commit.
- Operação e limites documentados em `docs/chave-pessoal-prontuarios.md`.
