# ADR-S10-01: Campos do hash da trilha de auditoria

## Contexto

`AuditChain.ComputeHash` (S10-01) precisa de uma serialização canónica e reproduzível de cada
entrada antes de a passar a `SHA256.HashData`. "Canónica" aqui significa duas coisas: (1)
qualquer verificador futuro -- outra linguagem, outro runtime, um script de auditoria externo
que só lê a base -- tem de conseguir recalcular exatamente o mesmo hash a partir das mesmas
sete colunas de `audit_entries`, sem ambiguidade de ordem ou de largura; (2) uma vez uma linha
escrita, `entry_hash` cobre-a para sempre -- `audit_entries` é append-only (sem `UPDATE`/
`DELETE` concedidos a `app_role`, ver a migração `0006`), então mudar a lista ou a ordem dos
campos depois de a primeira linha real existir invalida retroativamente toda a cadeia já
escrita, não apenas o código novo.

## Decisão

O preâmbulo hasheado tem exatamente 82 bytes, todos os campos de largura fixa, big-endian,
concatenados sem separador nem prefixo de comprimento -- a ambiguidade de concatenação só
existe com campos de largura variável, e nenhum dos seis aqui é:

```
[ 0..32)  previous_hash   32B   (génese = 32 bytes zero, nunca NULL)
[32..48)  tenant_id       16B   Guid.ToByteArray(bigEndian: true)
[48..56)  sequence         8B   int64, big-endian
[56..58)  action           2B   int16, ordinal de Api.Audit.AuditAction
[58..74)  device_id       16B   Guid.ToByteArray(bigEndian: true)
[74..82)  recorded_at      8B   int64, microssegundos desde a época Unix, big-endian

entry_hash = SHA256.HashData(preâmbulo)
```

`bigEndian: true` explicitamente, e não `Guid.ToByteArray()`/`TryWriteBytes()` sem o parâmetro:
o layout nativo de `Guid` no .NET é mixed-endian (os primeiros três grupos ficam em ordem de
bytes da máquina, os dois últimos em ordem de rede), o que o tornaria dependente da arquitetura
de quem o produziu -- inaceitável para um hash que outro sistema, ano nenhum sabe onde, tem de
reproduzir bit-a-bit.

`recorded_at` é codificado em microssegundos desde a época Unix, não em
`DateTimeOffset.Ticks` (unidades de 100ns desde 01-01-0001): ticks amarra o hash à resolução e
à época do relógio do .NET especificamente -- um verificador escrito noutra linguagem teria de
reproduzir essa convenção exata em vez de uma unidade e uma época universalmente conhecidas.

Dois campos ficaram de fora deliberadamente:

- **Sem `actor_id`.** Neste modelo, `tenant_id` já é o profissional dono da conta (mesma
  convenção que `patient_record_entries` e `note_signatures` já assumem) -- um `actor_id`
  seria idêntico a `tenant_id` linha a linha, sem informação nova a hashear ou a auditar.
- **Sem `DEFAULT now()` na coluna `recorded_at`.** O valor hasheado e o valor armazenado têm de
  ser exatamente o mesmo instante -- se a coluna tivesse `DEFAULT now()`, o Postgres decidiria
  o valor *depois* de a aplicação já ter computado `entry_hash` a partir de um valor diferente
  (o timestamp que a aplicação leu antes do INSERT), e a verificação falharia sempre, mesmo sem
  qualquer adulteração. O valor tem de nascer na aplicação -- é ela quem hasheia -- e viajar
  como parâmetro do INSERT, nunca como default gerado pela base.

## Consequências

- Qualquer verificador -- incluindo um escrito do zero, fora deste repositório -- reproduz
  `entry_hash` a partir das sete colunas visíveis de `audit_entries`, sem depender de nenhuma
  convenção de runtime além de "SHA-256 sobre 82 bytes big-endian nesta ordem".
- **Mudar esta lista ou esta ordem depois de existir uma linha real é caro.** Como
  `audit_entries` é append-only e cada `entry_hash` está calculado sob este layout
  especificamente, uma mudança futura (acrescentar um campo, reordenar, trocar a unidade de
  `recorded_at`) não pode reescrever hashes já gravados -- exige um `hash_version` implícito no
  verificador (um ramo por versão de layout, sabendo a partir de que sequência cada versão
  entrou em vigor) em vez de uma troca simples de constante. `hash_version` como coluna
  explícita foi considerado e recusado no ticket por não ter ainda um segundo layout para
  distinguir -- mas é exatamente o mecanismo que este ADR obriga a introduzir no dia em que a
  lista de campos precisar de mudar.
- Nenhum campo de conteúdo clínico entra no preâmbulo nem na tabela -- reforça, não compete
  com, o critério de aceite 4 (`AuditEntries_HasExactlyTheSevenMetadataColumns`).
