# ADR-S10-02: Consentimento em claro no servidor, por finalidade

## Contexto

O critério de aceite S10-02 exige que cada finalidade (gravação, análise por IA) tenha consentimento próprio e revogável, e que a revogação bloqueie ação futura sem afetar ação passada. O produto é zero-knowledge: `patient_record_entries` (S03-01) estabeleceu que todo campo clínico é um blob cifrado opaco ao servidor, e o mesmo molde serviria aqui -- um log de consentimento cifrado no cliente, guardado no OPFS.

Esse caminho falha em três pontos, e nenhum deles é de implementação. Um servidor que não consegue ler a decisão não consegue impor portão nenhum: recusar uma gravação passa a depender de o cliente se lembrar. O log viveria no browser onde foi escrito, portanto a revogação morre na troca de dispositivo. E a prova de auditoria passaria a exigir que o auditor peça a chave ao próprio responsável pelo tratamento -- prova que depende da cooperação de quem está a ser auditado não é prova.

O precedente existe e é do mesmo tipo. A ADR-S04-02 pôs `starts_at` e `duration_minutes` em claro porque a deteção de conflito exigia que o servidor comparasse valores; aqui o que o servidor tem de fazer é decidir, e decidir sobre ciphertext não é decidir.

## Decisão

`consent_events` (migração `0007_create_consent_events.sql`) guarda cinco colunas de metadados em claro: `tenant_id`, `patient_id`, `purpose`, `decision` e `recorded_at`. Zero texto livre, zero conteúdo clínico. `patient_id` continua um uuid nu, sem nome nem nota, a mesma referência que `patient_record_entries` e `scheduled_sessions` já usam.

A tabela é um log append-only. Revogar é um `INSERT` com `decision = Revogado`, nunca um `UPDATE` sobre a linha da concessão. O estado atual não é coluna: é o fold do log (`Api.Consent.ConsentState.Fold`, puro, sem I/O), com a regra "último evento daquela finalidade vence; sem eventos, pendente". O par `GRANT SELECT, INSERT` / `REVOKE UPDATE, DELETE` sobre `app_role` é o que torna "não afeta ação passada" estrutural em vez de uma regra que a aplicação se lembra de cumprir.

`recorded_at` é `DEFAULT now()` devolvido por `RETURNING`, no molde de `note_signatures.signed_at`, e não o relógio do cliente. Ao contrário de `audit_entries`, aqui não há hash a casar com o instante; o que se ganha em ter um único relógio, o do Postgres, é uma ordem total sobre a qual o fold pode assentar.

As finalidades são um enum fechado de dois valores -- `Gravacao` e `AnaliseIa` -- cada um com um consumidor real e distinto, fixado por `CHECK (purpose BETWEEN 0 AND 1)`. Não é tabela de lookup: finalidades são features do produto compiladas, não estado configurável por clínica.

## Consequências

- O servidor passa a ver, por paciente, que finalidades foram consentidas e quando a decisão mudou. É metadado de governo do tratamento, não conteúdo clínico, e é uma exceção deliberada e localizada ao princípio zero-knowledge, no mesmo molde da ADR-S04-02. Nenhum campo que identifique a pessoa ou descreva a sessão passa a trafegar em claro.
- A revogação passa a valer em qualquer dispositivo, porque o estado vive num sítio que todos os dispositivos leem.
- O `REVOKE UPDATE, DELETE` fecha a porta a uma correção feita a quente sobre o log. Corrigir um evento errado é acrescentar outro; não há caminho de aplicação que apague história.
- `consent_events` é a sua própria trilha -- append-only, imutável para `app_role` e datada --, e por isso a concessão e a revogação não escrevem entrada em `audit_entries`. No dia em que `actor_id` e `subject_id` existirem, ligar `AppendAsync` a `ConsentService.RecordAsync` é uma linha, num só sítio.
- O log responde a "havia consentimento no instante T?" sem mudar schema, mas nada hoje faz essa pergunta e nenhum endpoint a serve.
- `now()` é o instante de início da transação: duas escritas concorrentes para o mesmo par (paciente, finalidade) podem ficar ordenadas pelo relógio e não pela ordem de commit. Não é caminho concorrente real -- mesmo profissional, mesmo paciente, ação manual -- e o teto está escrito no comentário `ponytail:` da migração, com a sequence por `(tenant, patient, purpose)` como upgrade, tal como `audit_entries` já faz.
