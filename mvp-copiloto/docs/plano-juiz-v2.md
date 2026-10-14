
## Resultado das medições (8 de outubro de 2026)

Tudo medido no desenvolvimento, sem treino nas obras de teste. Dados em
`mvp-copiloto/data/juiz-v2/` e scripts em `mvp-copiloto/scripts/juiz_v2/`.

- **Rerankers e LLMs sem treino** (2.122 pares-ouro): Gemma 4 E4B AUROC 0,966 (único com
  Wilson ≥ 0,88: precisão 0,905, recall 0,862 no corte 0,35); Qwen3 4B 0,894; Gemma E2B 0,792;
  Qwen3-Reranker 4B 0,778; Qwen3-Reranker 0,6B 0,662; jina v3 0,641.
- **Busca** (página-alvo entre as N primeiras, 250 casos): base 28% (10), 44% (30), 74% (200);
  com reescrita da fala em fenômeno clínico (E4B, PT/EN/ES): 44%, 58%, 89%.
- **Fluxo completo** (portão + reescrita + busca top-50 + juiz): neutro 0%, terapeuta 0%,
  quase-acerto 4% dão cartão; 82% das falas clínicas gerais recebem cartão.
- **Precisão real dos cartões** (auditoria manual de 30 fora do gabarito): E4B 47%. O
  sim/não satura (nota 1,00 em tema parecido); Gemma 26B também ~50%; nota 0–9 do 26B separa
  melhor (AUROC 0,71) mas não roda em GPU de 6 GB; verificação por citação não ajudou (43%).
- **Ajuste LoRA do E4B** (250 pares difíceis rotulados à mão + gabarito; validação por obra,
  dobra 0): casos difíceis AUROC 0,631 para 0,791, precisão dos aprovados 37% para 59% (prob
  ≥ 0,8); geral 0,935 para 0,978. Adaptador final (todos os dados) em
  `mvp-copiloto/data/juiz-v2/lora/final`, ainda sem validação ponta a ponta.

Pendente: validar o juiz ajustado ponta a ponta em obras separadas, medir VRAM e latência em
GTX 1660, e só então a qualificação independente. Crédito Vast em $0,08; instância 54728473
parada (disco mantido para não refazer o ambiente).
