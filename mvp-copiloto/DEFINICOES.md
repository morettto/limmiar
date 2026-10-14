# Copiloto de referências: definições fechadas do MVP

Contrato atualizado em 01/10/2026 por orientação do usuário. As medições de 26/09/2026 abaixo são históricas. Este documento fecha o MVP e é a entrada para planear a implementação no Limmiar.

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

| Etapa | Tecnologia | Onde corre | Tempo medido |
|---|---|---|---|
| Ingestão | pypdf, divisão em página e parágrafo, filtro de não-prosa (tabelas, referências, métodos, questionários), SQLite | CPU, uma vez por PDF | ~minutos por livro |
| Índice | bge-m3 (denso) + BM25, fusão RRF, 3 idiomas (tradução Opus-MT CTranslate2) | GPU (bge-m3) + CPU | busca 100–170 ms |
| Triagem | regressão logística sobre o vetor bge-m3 (clínica, risco, ambígua) | CPU | ~20 ms |
| Juiz | gte-multilingual-reranker-base afinado (Apache-2.0), 10 candidatos | GPU | 200–260 ms |
| Verificação | citação por semelhança de frase + conferência no PDF | CPU | < 80 ms |
| API | FastAPI (produto: `/api/consultar-qualificado`, `/api/saude`; pesquisa: `/api/consultar`, `/api/acervo`) | servidor | — |
| Total | | GPU 6 GB, sem tensor cores | ~0,4 s típico, < 1 s p95, VRAM < 4 GB |

O Jev (TypeSafe) não corre em produção. Serve de professor, que rotula os pares para treino, e de avaliador. Os rótulos do Claude são a referência final.

## 4. Qualidade medida (números reais)

Ver `resultados/benchmark-local-2026-09.md` (secções 1 a 9) e o ponto 9 abaixo.

| Medida | Estado | Meta |
|---|---|---|
| Cartões em falas neutras e do terapeuta | 0% | ~0% ✅ |
| Falas ambíguas sinalizadas | 94% | ≥ 90% ✅ |
| Latência e memória | < 1 s, < 4 GB | ✅ |
| Correspondências reais com cartão (conjunto de produto, prova) | 56% (sem mudança na ronda 4) | ≥ 80% |
| Cartões errados (conjunto de produto, prova) | 4,7% | ≤ 5% ✅ |
| Precisão no corpus de teste nunca visto | 0,48–0,58 | ≥ 0,95 ❌ |
| Falas de risco sinalizadas | 74–79% | ≥ 95% ❌ |

Leitura honesta: o MVP prova o fluxo, o contrato, a latência e a arquitetura. A qualidade do juiz local ainda não chega ao nível de produção. É isto que o plano de implementação tem de resolver (ponto 7).

## 5. Como correr

- App de pesquisa: `rodar.bat` e depois http://127.0.0.1:8001. O navegador abre quando os modelos terminam de carregar.
- Frases verificadas para demonstração: `resultados/frases-que-trazem-cartao.md`.
- Treino completo: `resultados/treinar.bat`. Medição única no teste: `resultados/avaliar_local_teste.bat`.
- Conjunto de produto: `scripts/avaliar_produto.py` e `scripts/avaliar_http.py --corpus produto_prova`.
- Contratos: `scripts/testes.py` e `scripts/teste_jev.py`.

## 6. Decisões tomadas e porquê

| Decisão | Porquê |
|---|---|
| RAG com juiz, sem treinar um LLM nos PDFs | Um PDF novo entra sem treino. A citação vem sempre do PDF. |
| Juiz local pequeno em vez de um LLM de 3–9B | Os LLMs locais medidos ficaram em 0,70–0,87 de precisão e 56–107 s por fala nesta GPU. |
| gte-reranker afinado em vez de bge-reranker, Qwen3-Reranker ou mmBERT | Foi o melhor no desenvolvimento dentro de < 1 s e < 4 GB. |
| Jev só como professor | Decisão do dono do produto. Evita que a fala do paciente saia da máquina. |
| Filtro de não-prosa na ingestão | Os cartões errados vinham sobretudo de tabelas e referências. |
| Contexto nas duas últimas falas do paciente | A consulta preserva referências e negação mesmo em falas longas. |

## 7. O que falta para produção (entra no plano do Limmiar)

1. Dados de treino do juiz: é o gargalo medido. Rotular 3 000 a 5 000 pares por clínicos ou pelo Claude, com negativos difíceis, e treinar de novo. O ciclo já existe (`treinar.bat`).
2. Uma GPU com tensor cores (RTX 3060 ou melhor, ou uma instância na cloud). Com ela, um juiz maior (0,6–1,5B) fica em < 1 s. Isto ainda não foi medido; é o próximo teste de maior impacto.
3. Dois níveis de cartão: "correspondência" e "leitura relacionada", para não perder dicas úteis sem baixar a precisão.
4. Juntar os pedaços da transcrição numa fala antes de julgar.
5. Acervo: a cobertura de temas decide o que pode aparecer. Precisa de curadoria por tema clínico.
6. Seleção de obras por profissional (o filtro `obras_ids` já existe na API).
7. LGPD: o processamento fica local. Os dados de treino são sintéticos ou anonimizados.

## 8. Ficheiros principais

`src/copiloto/{ingestao,parse,busca,treinado,decisao,api}.py`, `src/copiloto/web/index.html`, `scripts/treinar.py`, `data/limiares-treinado.json`, `modelos/juiz-local/`, relay em `../.harness/handoff/copilot-s19-execucao.md`, spec S19 no vault.

## 9. Resultado da ronda 4 (2026-09-26)

Claude rotulou 5418 pares (328 positivos, 299 falas, com 49 negativos duros de lesão acidental). O gte-r4 treinado com estes rótulos não bate o gte-r2 fora-da-parte (parte 0 do ajuste, limiar 0,75: 8/27 contra 10/27). A expansão de consulta com sinónimos clínicos dá +1 acerto e +3 cartões errados no ajuste. Nenhuma das duas mudanças entrou. O vencedor fica o gte-r2.

| Medida | Valor | Meta |
|---|---|---|
| Correspondências reais com cartão (prova, HTTP) | 37/66 (56%) | ≥ 80% ❌ |
| Cartões errados em negativos (prova) | 2/43 (4,7%) | ≤ 5% ✅ |
| Precisão no corpus de teste | 0,477 | ≥ 0,95 ❌ |
| Falas de risco sinalizadas (teste) | 0,74 | ≥ 0,95 ❌ |
| Latência p95 (HTTP, prova) | 816 ms | < 1 s ✅ |
| VRAM | 3,42 GiB | < 4 GB ✅ |
| Juiz e limiar | gte-r2, 0,75 | |
