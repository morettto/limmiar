# Copiloto de referências: definições fechadas do MVP

Contrato atualizado em 01/10/2026 por orientação do usuário. A stack e o estado do juiz foram revistos em 21/10/2026. Este documento fecha o MVP e é a entrada para planear a implementação no Limmiar.

## 1. O que o produto faz

Durante a sessão, cada fala do paciente é comparada com o acervo de PDFs (livros e artigos, pt-BR, es, en). Aparece um cartão só quando um trecho descreve o mesmo fenómeno clínico que o paciente expressa. O cartão mostra obra, autor, página, parágrafo e a citação literal, conferida no PDF. Em qualquer outro caso, o copiloto fica em silêncio.

## 2. Contrato (regras que não mudam)

1. Silêncio por defeito. Retornar todas as fontes semanticamente e contextualmente pertinentes entre os candidatos aprovados. Não cortar a resposta no maior score. Obras independentes são preservadas; a mesma passagem não se repete.
2. Só as falas do paciente contam. As falas do terapeuta nunca geram cartão.
3. A citação é escolhida e conferida por código no texto do trecho e na página do PDF. O modelo nunca escreve a citação.
4. Há dois canais:
   - Risco (ideação suicida, autolesão, violência por parceiro): alerta discreto, sem diagnóstico. Aqui a prioridade é não perder casos.
   - Geral: a prioridade é a precisão.
5. Uma fala ambígua ("vontade de sumir") gera um pedido de clarificação e nunca uma referência.
6. A fala atual é julgada com as duas últimas falas confirmadas do mesmo paciente, inclusive quando a fala atual é longa. O contexto não inclui falas do profissional ou de outro paciente.
7. Um PDF novo não obriga a treinar de novo. O treino do juiz é um passo offline e ocasional.

## 3. Stack escolhida

| Etapa | Tecnologia | Onde corre |
|---|---|---|
| Ingestão | pypdf, divisão em página e parágrafo, filtro de não-prosa (tabelas, referências, métodos, questionários), SQLite | CPU, uma vez por PDF |
| Índice | bge-m3 denso sobre a fala; cada trecho guarda também a nota `generico` do juiz, calculada na preparação | CPU (bge-m3 em ONNX int8) |
| Risco | cabeça linear sobre o vetor bge-m3 da fala (`risco.py`), antes do portão | CPU, no processo da API |
| Juiz | `juiz-pequeno-v1` (`juiz_pequeno.py`): cross-encoder mmBERT-small destilado, em ONNX; o portão é `vivencia`, os trechos com `generico` acima do corte saem, e o maior `principal` vira cartão se passar do corte | CPU, no processo da API |
| Verificação | citação: a frase do trecho vencedor de maior `principal`, conferida no PDF | CPU |
| API | FastAPI (produto: `/api/consultar-qualificado`, `/api/saude`; pesquisa: `/api/consultar`, `/api/acervo`) | servidor |

Sem cortes da versão no registro não há juiz de reserva: o copiloto não mostra cartões e `/api/saude` diz porquê.

## 4. Qualidade do juiz

O juiz é o `juiz-pequeno-v1`, registrado em `data/juiz-v2/registro.jsonl` com cortes provisórios que ainda serão medidos. O histórico abaixo é o da cascata `cascata-v2`, que ele substitui, registrada com a margem 1,0 e as medições. A `cascata-v1` media o juiz sobre candidatos que já continham a âncora (precisão 0,89, cobertura 0,66); no produto ponta a ponta ela deu precisão 0,43 e cobertura 0,22, porque a busca perdia a âncora. A v2 corrige a busca (só a fala e a reescrita, sem contexto), o portão (sem thinking, aceita enfrentamento e progresso) e pede ao juiz o fenômeno específico. Ponta a ponta nas 10 sessões: precisão contra a âncora única 0,73 (43/59), cobertura 0,43, cobertura por tema 0,70 e 0 cartões falsos em 60. A precisão contra a âncora é um piso: outro material da sessão às vezes também explica a fala, e só as notas do profissional dizem quanto. Ainda não foi promovida: a promoção espera essas notas em `scripts/juiz_v2/ciclo.py decidir`.

A v2 (LoRA) foi descartada: a 90% de precisão cobre 9% do gabarito, contra 45% do Gemma base.

## 5. Como correr

- App de pesquisa: `rodar.bat` e depois http://127.0.0.1:8001. O navegador abre quando os modelos terminam de carregar.
- Juiz: os arquivos do `juiz-pequeno-v1` em `modelos/juiz-pequeno` (`tokenizer.json` e `onnx/model_gather.onnx`).
- Contratos: `scripts/testes.py`.
- Medição ponta a ponta no gabarito: `tools/atendimento-simulado/gold/avaliar_copiloto.py`.
- Promoção de uma versão nova: `scripts/juiz_v2/ciclo.py decidir`.

## 6. Decisões tomadas e porquê

| Decisão | Porquê |
|---|---|
| RAG com juiz, sem treinar um LLM nos PDFs | Um PDF novo entra sem treino. A citação vem sempre do PDF. |
| Juiz LLM servido por URL em vez de um reranker local | O reranker local afinado antes ficou perto do acaso no gabarito (AUROC 0,48). O servidor do juiz não guarda estado e usa a mesma imagem para todos os clientes. |
| Promoção pelas duas réguas | Uma versão nova só entra se passar no teste fixo, que barra regressão, e nas notas do profissional, que medem a melhora. A regra está em `scripts/juiz_v2/ciclo.py` e em `../docs/juiz-ciclo-de-treino.md`. |
| Cascata aluno e professor no lugar da v2 | O aluno sozinho satura (AUROC 0,916, topo 63-64/100) e a v2 perde para o Gemma base. O aluno só filtra: 6 chamadas de LLM por fala clínica em vez de cerca de 44, e o trecho vem antes da fala no prompt para o servidor reaproveitar o prefixo. |
| Juiz pequeno no lugar da cascata e do Laya | O copiloto e o juiz cabem num processo de CPU, sem API paga na hora da fala. Nas falas novas de validação, a regra "sem os genéricos, o maior `principal` acima de um corte alto, depois do portão de vivência" acertou 11 de 11. |
| Filtro de não-prosa na ingestão | Os cartões errados vinham sobretudo de tabelas e referências. |
| Contexto nas duas últimas falas do paciente | A consulta preserva referências e negação mesmo em falas longas. |

## 7. O que falta para produção (entra no plano do Limmiar)

1. Juiz: medir os cortes do `juiz-pequeno-v1` no gabarito e promovê-lo pela regra das duas réguas, depois das notas do profissional.
2. Juntar os pedaços da transcrição numa fala antes de julgar.
3. Acervo: a cobertura de temas decide o que pode aparecer. Precisa de curadoria por tema clínico.
4. Seleção de obras por profissional (o filtro `obras_ids` já existe na API).
5. LGPD: o processo do copiloto vê o texto da fala e do trecho. Os dados de treino são sintéticos ou anonimizados.

O copiloto só envia o nível `forte`: todo cartão passou o único corte registrado.

## 8. Ficheiros principais

`src/copiloto/{ingestao,parse,busca,risco,juiz_pequeno,decisao,api}.py`, `src/copiloto/web/index.html`, `scripts/juiz_v2/ciclo.py`, `data/juiz-v2/registro.jsonl`, `data/juiz-pequeno.json`, `modelos/juiz-pequeno`, relay em `../.harness/handoff/copilot-s19-execucao.md`, spec S19 no vault.
