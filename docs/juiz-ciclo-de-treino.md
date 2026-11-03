# Ciclo de treino do juiz

O juiz decide se um trecho do material do profissional explica a fala do paciente. Os PDFs do
profissional nunca treinam nada: só alimentam a busca. O que melhora o juiz são os **votos**
"útil / não útil" sobre os cartões, mais o teste fixo que decide se uma versão nova pode entrar.

## 1. Voto (contrato)

Uma linha JSON por voto, gerada no aparelho do profissional e **só enviada com consentimento**:

```json
{"v":1,"consentiu":true,"usuario":"<pseudônimo estável>","fala":"...","contexto":["..."],
 "trecho":"...","obra":"<nome da obra>","voto":"util|nao_util","juiz":"<versão>","em":"2026-10-08T10:00:00Z"}
```

O app envia o voto com `POST /copiloto/api/votos?accountId=<id>` (Bearer da conta, a mesma autorização do
acervo pessoal), **só depois do consentimento do profissional**. O serviço responde 204 e anexa a linha a
`mvp-copiloto/data/votos/votos.jsonl` (ignorado pelo git); 400 se `consentiu` não for `true`, o evento for
inválido ou passar dos limites (corpo 16 KB, fala 2000, trecho 3000, contexto 5 itens de 2000, demais campos 200).
Corpo e `usuario` nunca vão para log. Sem `consentiu: true` o voto é descartado. Um voto é dado de saúde (traz a fala do paciente):
exige consentimento por finalidade, anonimização do `usuario` e revisão jurídica antes de sair
do aparelho. Enquanto isso não existir, os votos servem só ao ajuste local.

## 2. Limpeza (`src/copiloto/votos.py`)

Vale o último voto de cada usuário em cada par; entre usuários, a maioria. Saem: sem
consentimento, par do teste fixo, trecho que não é prosa, poucos usuários, empate. Aceitar não
é o mesmo que acertar, então o voto é sinal com ruído: antes de cada retreino se confere uma
amostra à mão.

## 3. Teste fixo (`scripts/juiz_v2/teste_fixo.py`)

Congelado, com hash em `data/juiz-v2/teste-fixo.manifesto.json`. Contém:
- todas as obras de teste (uma em cada cinco, escolhida pelo nome do arquivo, para sempre);
- todos os rótulos do profissional (os 100 cartões), que valem mais que os meus.

Nada disso entra em treino: nem a obra, nem o par. Mudar o teste fixo exige `--nova-versao` e
reavaliar o juiz ativo. Rodar: `python teste_fixo.py construir`.

## 4. Retreino e decisão (cascata)

O juiz de produção é uma cascata. O aluno (`gte-multilingual-reranker-base` com LoRA, em
`mvp-copiloto/modelos/juiz-local/aluno-gte-v1`) ordena os candidatos da busca e fica com os 6 primeiros. O professor
(Gemma 4 E4B base, adaptador desligado) julga esses 6 com o pedido de `copiloto.juiz_llm.pedido_juiz`. O cartão sai
quando o professor diz sim ao melhor material (nota >= 0,5) e a margem de logit entre ele e o segundo material passa do
limiar da versão. A regra está em `copiloto/cascata.py`, e o gabarito usa as mesmas funções.

Uma versão nova nasce assim, da raiz do repositório:

1. `tools/atendimento-simulado/treino-juiz/` gera e confere os pares e treina o aluno (o README da pasta tem os passos).
   O professor rotula com o mesmo pedido que a produção envia, então o rótulo e o julgamento não se separam.
2. `gold/bakeoff_juiz.py --alunos PASTA` dá as notas do aluno no gabarito pelo carregador de produção (`copiloto.aluno`).
   `--juizes producao` dá as do professor pelo servidor local de `tools/juiz/local.ps1`.
3. `gold/cascata.py --aluno ... --professor ... --versao cascata-vN --registrar` fixa o limiar (a menor margem com
   precisão >= 0,90 nas 10 sessões) e grava a versão no registro como medida, com a estimativa fora da dobra (limiar das
   sessões 001-005 medido em 006-010 e vice-versa).
4. `gold/avaliar_copiloto.py RUN` roda o produto ponta a ponta no gabarito e grava o resumo de `gold/pontuar.py`. O
   limiar não se ajusta nessa rodada.
5. `gold/rotulagem.py RUN` lista os cartões mostrados para o profissional avaliar, no formato de `rotulos_5k.py`.

A promoção (`"promovida": true`) continua sendo do `ciclo.py decidir`, com as duas réguas: o teste fixo barra regressão
e as notas do profissional medem a melhora. Sem as notas do profissional a versão fica medida e não é promovida.

## 5. Liberação por versão

O copiloto atende a versão que vem em `COPILOTO_JUIZ_VERSAO` só se ela constar em
`mvp-copiloto/data/juiz-v2/registro.jsonl` com `limiares.margem` finita. Sem isso, sem `COPILOTO_JUIZ_URL` ou com o
servidor fora, a rota de produto responde 503 e `/api/saude` diz o motivo (`motivo`). Não há juiz de reserva. A saúde
também diz se a versão foi promovida (`juiz_llm.promovida`). Cada linha NDJSON da consulta traz o campo `juiz` (essa
versão), que o app copia para o voto.

Cada fala gera no máximo um cartão, o melhor trecho do material vencedor, com nível `forte`. A citação literal é a frase
desse trecho que o aluno mais aproxima da fala. `data/limiares-juiz-llm.json` guarda só os limiares do portão (clínica,
risco, ambígua).

## Limites

- A reamostragem é por par, não por obra, então a incerteza real é maior que a calculada.
- O adaptador v0 (`data/juiz-v2/lora/final`) viu obras de teste e está aposentado. A v1
  (`data/juiz-v2/lora/v1`) foi treinada sem elas; o ativo inicial de comparação é o modelo base.
- Cada versão precisa de nova conversão para o formato do navegador (ver ADR-0011).

## Qualificação de 5 mil falas (2026-10-08)

Falas sintéticas geradas a partir do acervo de teste (obras que o juiz nunca viu): 3.092 positivas (3 por trecho, sem
vocabulário técnico, com a fonte conhecida), 800 neutras, 600 de expressão figurada, 300 do terapeuta e 300 ambíguas.
Scripts em `mvp-copiloto/scripts/juiz_v2/`: `gerar_frases.py`, `qualificar5k.py`, `revisao_html.py`, `rotulos_5k.py`.

Resultado (juiz v1, limiar 0,9, até 3 cartões por fala, 6 falas em paralelo):
- positivas com cartão: 1.211 de 3.092 (39%); a fonte exata aparece em 290 (9%), a página dela em 396 (13%);
- neutras 0/800, terapeuta 0/300, expressão figurada 23/600 (3,8%), ambíguas 7/300 e pedido de esclarecimento em 194/300;
- primeiro cartão em 8,5 s (p50) e 12,9 s (p95) com 6 falas simultâneas na mesma GPU (sequencial foi 2,6 s).

Avaliação humana: `data/juiz-v2/q5k/revisao/rotular-5k.html` (300 cartões: 75 na fonte exata, 188 em outros trechos,
37 de falas negativas). Depois de baixar `rotulos-5k.json`:
`python rotulos_5k.py data/juiz-v2/q5k/revisao/rotulagem-5k.json rotulos-5k.json data/juiz-v2/q5k`.
A taxa de acerto da `fonte_exata` diz se as falas geradas valem como positivo; metade das obras vira treino e metade
teste novo, e a v2 só entra pela regra de promoção.

## v2 (2026-10-08)

Treinada com o treino da v1 mais 164 cartões com a nota do profissional como alvo suave (inclusive as dúvidas), 2 épocas.
Nas 101 avaliações reservadas (7 obras que nenhuma versão viu): correlação com a nota 0,65 (v1 0,36; base 0,60); aprova 23
de 101 em vez de 96, com 57% na faixa sim (v1 18%) e 77% de cobertura dos sim. Teste fixo: precisão 97,7% (v1 96,2%),
cobertura 62% (v1 72%), AUROC geral 0,974 (v1 0,967). Como a v2 foi treinada para prever a nota, a previsão tem a escala
do profissional: >= 0,9 é "sim" e 0,7 a 0,9 é "dúvida".

## Votos: treino e medição (2026-10-09)

`ciclo.py montar` separa os votos limpos por obra (mesma regra de `rotulos_5k.lado`): as obras do lado "treino" entram no treino da próxima
versão; as do lado "teste" vão para `SAIDA.votos-teste.jsonl` (`alvo_suave` 0 ou 1) e nunca treinam. Depois do treino, gere previsões do
candidato e do ativo nesse arquivo com `prever_lora.py` e passe-as como 4º e 5º argumentos de `ciclo.py decidir`: a melhora é medida pelo
que os profissionais votaram em obras que o modelo não viu. Ainda não há votos reais; o caminho está testado com votos sintéticos.
Teto honesto: com rótulo humano ruidoso e obras novas a cada profissional, a precisão tende a subir e estabilizar, não chega a 100%.


## Auditoria de independência e escala (2026-10-15)

**P1 — a régua histórica não é independente por fonte.** Na cópia local auditada,
`treino-ciclo2.jsonl` tem 2.232 linhas, 1.904 pares únicos, 946 falas únicas e 50 obras.
Os 164 cartões humanos aparecem três vezes: repetição aumenta peso, não cobertura.
O teste fixo de 377 pares compartilha 17 obras e 142 falas com esse treino, embora
não compartilhe pares exatos. As 101 avaliações humanas reservadas não compartilham
obras nem pares, mas compartilham quatro falas. Portanto os números históricos acima
não demonstram generalização independente por obra/família, nem calibração extrema.
O teste fixo e os artefatos promovidos foram preservados para rastreabilidade.

`mvp-copiloto/scripts/juiz_v2/candidato_cpu.py` gera uma experiência separada: exclui
as obras, falas normalizadas e passagens normalizadas de ambas as réguas do treino;
reserva desenvolvimento por obra e exclui também suas falas/passagens do treino.
Na auditoria local resultaram treino 314 (80 positivos), desenvolvimento 139
(54 positivos), teste humano 101 (17 positivos). Não se confundem rótulos históricos
mistos com verdade clínica. Paráfrases e traduções ainda exigem curadoria de família.
Os manifestos e partições estão em `.local/simulacao-100/candidate-cpu/`.

Comando reproduzível, sem GPU e sem baixar pesos novos:

```powershell
$env:OMP_NUM_THREADS='2'; $env:MKL_NUM_THREADS='2'
mvp-copiloto/.venv-treino/Scripts/python.exe mvp-copiloto/scripts/juiz_v2/candidato_cpu.py .local/simulacao-100/candidate-cpu
```

É uma cabeça logística sobre E5 pequeno congelado, não um retreino do juiz Gemma.
O relatório mede Brier contra a prevalência constante do treino, AUROC, AP e precisão
no limiar fixo 0,9. Não ajusta limiar no teste e não promove modelo. O primeiro ensaio
foi interrompido antes de produzir embeddings para liberar RAM aos testes reais do app.
A máquina tem GTX 1660 SUPER de 6 GB e 16 GB de RAM; o treino LoRA BF16 existente
não cabe nessa GPU junto ao juiz de produção. Nenhuma melhoria foi medida neste ensaio.

### Chegar a milhões sem fabricar cobertura

`preparar_corpus.py SAIDA ENTRADA.jsonl ...` processa entradas em fluxo com SQLite,
sem carregar o corpus inteiro na RAM. Cada linha exige `fala`, `trecho`, `alvo` ou
`alvo_suave`, `source_family`, `source_uri`, `license`, `label_origin`, `reviewed: true`.
O responsável pelo corpus deve atribuir a mesma família às obras relacionadas,
traduções e paráfrases antes da separação. O script separa por família (80/10/10),
deduplica pares, põe rótulos conflitantes em quarentena e exclui falas/passagens
idênticas normalizadas que atravessam partições. Registra hashes dos arquivos de
origem e contagens reais. Isto não detecta sozinho equivalência semântica.

Não há milhões de falas revisadas disponíveis nesta cópia. Os arquivos de vetores
existentes têm 1.735×1.024, 2.193×1.024 e duas representações de 1.979×2.048;
não se devem somar representações repetidas como exemplos independentes. Corpus
público NLI/STS pode ajudar representação, mas seus rótulos não significam pertinência
clínica. Antes de ampliar: obter fontes licenciadas com proveniência e cobertura
real, curar famílias e negativos difíceis, revisar amostras por origem e manter um
novo teste clínico humano intocado. Embeddings não substituem esses rótulos.
