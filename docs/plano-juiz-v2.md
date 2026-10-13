# Plano do juiz bibliográfico v2

Data: 7 de outubro de 2026. Substitui a linha de juízes ajustados (R1–R5).

## O que falhou e por quê

- R3, R4 e R5 eram o Qwen3-Reranker-0.6B ajustado nas nossas obras de desenvolvimento.
  A validação fora-da-parte separava frases, não obras: as mesmas PDFs estavam no
  treino e na validação. A calibração media memória das obras.
- Nas obras de teste (nunca vistas), o R4 aprovou ~218 passagens por fala, com nota
  0,99 em artigos de suicídio para falas sem relação. Reranker mede tema; a tarefa é
  decidir se a passagem descreve o **mesmo fenômeno** que a frase do paciente.
- O acervo do profissional é sempre material novo. Qualquer juiz precisa ser medido
  em obras que não participaram do seu ajuste.

## Requisitos que não mudam

- Inferência final local: GTX 1660 Super, 6 GB, ~3 GB livres com o Nemotron ativo.
- Nada de texto clínico real fora da máquina; avaliação usa só casos sintéticos.
- Régua do usuário: Wilson ≥ 0,88, cobertura ≥ 0,70; risco ≥ 0,95; neutro ≤ 1%,
  terapeuta 0, quase-acerto ≤ 2%; primeiro cartão p95 ≤ 3 s **na GPU do usuário**.
- Conjunto `teste` só na qualificação final, uma vez.

## Etapas

1. **Avaliação que escala.** Rotulador de referência: o maior modelo aberto que cabe
   numa 3090 alugada (Gemma 4 31B ou Qwen3-32B, 4 bits), com a rubrica
   `frase-fenomeno-explicito-v2`. Medir a concordância dele com os ~500 rótulos
   humanos/Claude já existentes no desenvolvimento. Só vira rótulo de prata se
   concordar ≥ 95%; senão, a adjudicação continua manual e o volume de cartões por
   fala precisa ser limitado antes da qualificação.
2. **Candidatos sem treino nas nossas obras**, medidos no desenvolvimento sobre os
   K melhores candidatos da busca (bge-m3 híbrido; comparar recall@K com
   EmbeddingGemma 2):
   - Qwen3-Reranker 0.6B e 4B base, com instrução de fenômeno;
   - jina-reranker-v3;
   - Gemma 4 E2B/E4B e Qwen3-4B-Instruct, decisão sim/não por log-probabilidade.
   Se nenhum pequeno bastar: destilar o rotulador de referência num modelo pequeno,
   com partição **por obra** e validação em obras fora do treino.
3. **Latência real**: alugar uma GTX 1660/1660 Super e medir o pipeline inteiro com o
   Nemotron ocupando a mesma memória que ocupa no PC do usuário.
4. **Decisão** com tabela medida (precisão, cobertura, risco, latência, VRAM).
5. **Qualificação independente** no `teste`, uma vez, com limiar congelado no
   desenvolvimento.
6. **Implementação** no produto: busca top-K + juiz escolhido, todas as fontes
   aprovadas dentro do top-K, silêncio quando nada passa.

## Custos

Crédito Vast restante ~$2,57. Etapa 1 e 2 numa 3090 (~$0,17/h, ~3 h); etapa 3 numa
1660 (~$0,05/h, ~1 h).

## Medição na GPU do usuário (8 de outubro de 2026)

GTX 1660 SUPER, 6 GB, linha de base do Windows ~1,07 GB. llama.cpp b11500 (CUDA 12.4;
a build CUDA 13.4 falha no driver 591.86). Modelos Q4_K_M, contexto 2048, flash attention.

- Gemma 4 E2B: 1,65 GB de VRAM, 456 a 505 tokens/s de leitura de prompt.
- Gemma 4 E4B: 3,2 GB de VRAM, 241 tokens/s.
- Deslocar `per_layer_token_embd` para a CPU não mudou a VRAM (`-ot` sem efeito).
- O ASR Nemotron roda no navegador (WebGPU) na mesma placa: sobram cerca de 3 GB. E2B cabe
  com folga; E4B fica no limite e provavelmente não cabe com o ASR ligado.
- Por par, com o prefixo (regra + fala) em cache, entram ~200 tokens novos: ~0,4 s no E2B,
  ~0,8 s no E4B. Cartões podem aparecer em sequência, conforme cada par é julgado.

Decisão: o juiz de produção alvo é o **E2B ajustado com LoRA**; o E4B ajustado fica como
professor e opção para máquinas com mais VRAM. Falta treinar e validar o E2B por obra.

## Filtro de trechos (src/copiloto/trecho.py)

`prosa()` descarta cabeçalho, palavras-chave, lista de referências, tabela e OCR quebrado ao
carregar o índice (`Indice.recarregar`), sem mudar a numeração de parágrafos: 1,9% do acervo
de desenvolvimento e 2,5% do de teste; 0,4% dos positivos e 2,0% dos negativos rotulados.
