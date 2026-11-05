# treino-juiz

Destila um juiz de relevância pequeno e calibrado a partir de pares sintéticos que um professor (LLM aberto) escreve e
confere. Sem rótulo humano. Os 94 artigos das 100 sessões simuladas ficam de fora: o treino usa só os outros 120 do
manifesto. O gabarito por construção (`gold/`) é o teste.

## Ordem

Todos os comandos rodam da raiz do repositório com `mvp-copiloto/.venv/Scripts/python.exe`. Os dados ficam em
`.local/claude-goal/treino-juiz/`.

1. `corpus.py` corta os artigos de treino com o chunker do copiloto (`gold/passagens.py --pmcids`). Depois escolhe as
   passagens clínicas com o filtro de `gold/candidatos.py` e grava `corpus.jsonl`.
2. `professor.sh MODELO.gguf LOG` sobe o professor no llama-server em `127.0.0.1:8200`.
3. `gerar.py --saida principal/geracao.jsonl --limite 2000 --paralelo 4 --conversa 60 --saida-conversa principal/conversa.jsonl`
   escreve, por passagem, 4 falas positivas e 4 negativas difíceis (negação, terceiro, figurado, outro fenômeno). Também
   escreve um pool de conversa, logística e saudação. Retoma do ponto em que parou.
4. `verificar.py --geracao ... --conversa ... --saida principal --paralelo 4` dá P(yes) a cada par, inclusive aos pares
   cruzados do mesmo artigo e do mesmo tema. Grava `brutos.jsonl` e `pares.jsonl` (positivo com p >= 0,8, negativo com
   p <= 0,2). Retoma do ponto em que parou.
5. `amostra.py --pares principal/pares.jsonl --saida amostra-qualidade.jsonl` sorteia 20 positivos e 20 negativos
   para auditoria.
6. `treinar.py --aluno gte|qwen --pares principal/pares.jsonl --saida modelos/<nome> [--base qwen3-reranker-0.6b-q8_0.gguf]`
   treina um LoRA e calibra com isotônica nos artigos de validação. A divisão é por artigo, por hash do pmcid.
7. `gold/bakeoff_juiz.py --alunos modelos/<nome> ... --dispositivo cuda` mede o aluno no gabarito com a mesma tabela dos
   outros juízes.
8. `juiz_professor.py --nome X --saida DIR` mede o próprio professor no gabarito. Esse é o teto do aluno.

## Restrições medidas nesta máquina (GTX 1660 SUPER, 6 GB)

- Uma matmul fp16 roda a 0,58 TFLOPS, contra 4,8 TFLOPS em fp32. Por isso `treinar.py` usa bf16 só em Ampere ou mais
  novo e fica em fp32 aqui.
- Gemma 4 só reaproveita o prefixo da passagem com `--swa-full`.
- O cache de prompts em RAM do llama-server (padrão 8 GB) esgotou a memória. `professor.sh` passa `-cram 0`.
- Qwen3.5 (híbrido recorrente) não reaproveita prefixo nenhum. Cada par paga o prompt inteiro.
- Os LoRAs existem porque o disco livre não comporta uma cópia de 600 MB do gte. O aluno Qwen parte do `.gguf` local
  (dequantizado ao carregar), o que evita baixar 1,2 GB.
