# Simulação de 100 atendimentos e calibração do juiz

**Objetivo:** percorrer cadastro, cofre, voz, acervo e 100 atendimentos sintéticos com cinco materiais pertinentes por atendimento; medir defeitos antes de corrigir e repetir os casos afetados.

**Arquitetura:** Playwright MCP conduz a interface visível. Áudio, transcrição e juiz reais são medidos separadamente das fronteiras simuladas. Casos possuem identificador, perfil, duração original de 20–30 minutos, cinco materiais, falas esperadas e evidências. Aceleração não pode substituir transcrição ou respostas do juiz por resultados esperados.

**Stack:** aplicativo React existente, API .NET/PostgreSQL, gateway de fala/Nemotron, modelos e scripts Python existentes, corpus público PMC com licença e proveniência.

- [ ] Recuperar ambiente local e documentar estado dos serviços; reproduzir falhas do ensaio anterior.
- [ ] Conduzir cadastro visível, confirmar chave/TOTP, cadastrar voz real sintetizada e aprovar apenas a conta fictícia local.
- [ ] Baixar 200 PDFs públicos distintos, verificar licença, hash e tema; fazer upload pelo aplicativo e acompanhar preparo.
- [ ] Construir 100 perfis/roteiros, alternar cinco materiais relevantes por sessão e registrar exclusões.
- [ ] Executar sessões aceleradas com duas vozes e preservar a distinção entre duração original, execução efetiva e qualquer simulação.
- [ ] Medir transcrição, atribuição de falante, fontes/citações, falsos positivos/negativos, erros HTTP e acessibilidade; manter ledger de defeitos reproduzíveis.
- [ ] Remover Jev da execução; preparar treino e embeddings com deduplicação e divisão por fonte/família, sem usar o teste no treino.
- [ ] Treinar e comparar candidato com ativo no conjunto reservado; promover apenas se cumprir o contrato existente.
- [ ] Corrigir causas comprovadas, repetir testes e registrar contagens reais, limitações e pendências.

## Critérios de evidência

Não equivaler 100 replays do mesmo caso a 100 atendimentos diversos. Não equivaler zumbidos sintéticos com texto injetado a avaliação de ASR. Não chamar probabilidade do modelo de precisão clínica. Milhões de linhas não substituem rótulos independentes. Dados do acervo profissional não entram no treino; corpus público de treino mantém divisão independente das obras reservadas de avaliação. Não apagar contas ou dados existentes.
