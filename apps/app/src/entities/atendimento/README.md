# entities/atendimento

Um atendimento é uma sessão clínica do profissional com o paciente. Nasce de um
agendamento (o `sessionId` do `entities/agenda`) e é a identidade da sessão no
prontuário: a transcrição usa `atendimentoId` como `transcriptId` e a nota carrega
`atendimentoId` dentro do conteúdo assinado. Um agendamento tem no máximo um
atendimento; uma sessão sem agendamento recebe um agendamento criado na hora.

A entrada é cifrada como as demais do prontuário (`sealEntry`, AAD com
`patientId` + `sequence`): `{ tipo: 'atendimento', atendimentoId, agendamentoId,
iniciadoEm }`. `lerAtendimento` falha fechado e devolve `null` para qualquer
campo ausente, vazio ou malformado. `ABA_INSIGHTS`/`ABA_NOTA` são os valores de `?aba=` da página da sessão e
`FORMATO_DATA_ATENDIMENTO` o formato da data que a nomeia (vivem aqui, num `.ts`,
porque um `.tsx` não escreve esses literais sem o lint de i18n). A modalidade (presencial ou online) e os
insights não são gravados: a modalidade se escolhe dentro da sessão e os insights
são recalculados a partir da transcrição.
