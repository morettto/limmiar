# Referência qualificada e aprovação na nota

1. A fala continua recebendo insights durante a captura. A transferência para a nota exige transcrição salva, revisão atual, papel do paciente e consentimento vigente; abrir uma fonte não altera a nota.
2. O profissional escolhe uma fonte no balão. Mostrar a frase, a citação e seus dados antes de confirmar a inclusão na avaliação SOAP. Recusar outro prontuário, revisão substituída e nota assinada ou vinculada a outra sessão.
3. Vincular explicitamente a nota à sessão escolhida. Guardar frase, tempos e referência bibliográfica na mesma entrada cifrada da nota; a assinatura cobre esses campos. Não produzir diagnóstico ou substituir conteúdo escrito pelo profissional.
4. Retirada de consentimento, mudança de paciente ou revisão da transcrição invalida a proposta em memória. Repetir a confirmação não duplica a mesma referência. Somente salvar/assinar escreve no prontuário.
5. Testar seleção, cancelamento, invalidação, assinatura e reabertura cifrada. Provas com resposta simulada demonstram a interação e a cifra, sem aprovar o juiz clínico ou liberar sua rota qualificada.

Implementado e verificado: 1.321 testes em 135 arquivos, 100% de linhas, ramos,
funções e instruções (`.local/referencia-app-completo.log`). A prova no navegador
passou com cadastro existente, Postgres, transcrição cifrada, assinatura e
reabertura em outro contexto sem chaves pré-carregadas. Confirmação e cancelamento
não escrevem antes de salvar/assinar; abrir a referência recupera a revisão exata.
Desktop e 375 px sem violações axe ou transbordamento.

Evidências: `.local/referencia-aprovada-e2e.log` e
`.local/referencia-aprovada-prova.json`. Fala e fonte são sintéticas neste cenário;
o juiz permanece sem qualificação clínica. O cenário foi promovido a
`apps/app/e2e/referencia-aprovada.spec.ts` com cadastro próprio pela interface.
