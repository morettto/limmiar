# ADR-S04-02: Horário em claro no servidor apesar do produto ser zero-knowledge

## Contexto

O critério de aceite S04-02 exige que duas transações concorrentes pelo mesmo horário produzam exatamente um vencedor -- um conflito de agendamento detetado sob concorrência real, não apenas checado no cliente. `patient_record_entries` (S03-01) estabeleceu o padrão do produto: todo campo clínico é um blob cifrado opaco ao servidor. Detetar um conflito de horário exige, no entanto, que o servidor compare valores -- não há forma de um índice único de Postgres reconhecer "mesmo horário" sobre ciphertext.

## Decisão

`starts_at` e `duration_minutes` ficam em claro em `scheduled_sessions` (migração `0004_create_scheduled_sessions.sql`), não cifrados. É o metadado mínimo necessário para que o servidor detete o conflito com uma constraint de banco (`scheduled_sessions_live_slot_uq`, índice único parcial sobre `(tenant_id, starts_at) WHERE cancelled_at IS NULL`) em vez de reinventar essa deteção no cliente sob um lock distribuído. `patient_id` continua a ser apenas um uuid, sem nome, nota, ou qualquer outro campo em claro sobre a pessoa -- a mesma referência AAD-bound já usada por `patient_record_entries`.

## Consequências

- O servidor passa a ver a cadência e o volume de agendamento de cada profissional (quantas sessões, a que horas, com que frequência) -- metadado operacional, não conteúdo clínico. Isto é uma exceção deliberada e localizada ao princípio zero-knowledge do produto, não uma reversão dele: nenhum campo que identifique a pessoa ou o conteúdo da sessão passa a trafegar em claro.
- A deteção de conflito é garantida pelo próprio Postgres (UNIQUE), não por uma verificação de aplicação sujeita a corrida -- a mesma prova que `patient_record_entries` já demonstrou para `(tenant_id, patient_id, sequence)`.
- O índice é exato ("mesmo horário"), não de sobreposição parcial -- ver o comentário `ponytail:` em `0004_create_scheduled_sessions.sql` para o caminho de upgrade (`EXCLUDE USING gist` + `btree_gist`) se sobreposição parcial vier a ser requisito escrito.
