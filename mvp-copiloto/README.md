# MVP copiloto Limmiar

Documentação da arquitetura e da integração no produto:

- [Arquitetura, stacks, download e contratos](docs/arquitetura-copiloto.md)
- [Organograma do fluxo](docs/organograma-copiloto.md)
- [Plano de implementação no Limmiar](docs/plano-implementacao-limmiar.md)
- [Fontes oficiais da stack](docs/fontes-stack.md)

Protótipo do copiloto que vai entrar no Limmiar. Você sobe PDFs, fala ou escreve uma frase como um paciente falaria, e o sistema devolve o trecho da literatura que trata daquilo, com obra, autor, página e parágrafo. O texto citado é conferido contra o PDF antes de aparecer na tela.

É busca semântica com um juiz local treinado (RAG sem a etapa de geração). O juiz aprendeu com as notas do Jev; o Jev não corre em produção.

Na integração atual, a transcrição envia frases estabilizadas do paciente durante
a sessão e as referências são transmitidas progressivamente, sem limite fixo de
fontes ou quota por obra. A rota de produto responde 503 até que a versão do juiz
(`COPILOTO_JUIZ_VERSAO`) conste, promovida, em `data/juiz-v2/registro.jsonl`; sem
`COPILOTO_JUIZ_URL` ela nunca é liberada. Cada cartão sai como `forte` ou `possivel` conforme as faixas do registro da versão (a v2: 0,9 e 0,7). O [registro de implementação](docs/plano-implementacao-limmiar.md) descreve as provas
e pendências atuais; as medições das rondas antigas abaixo são históricas.

## Como rodar

```bash
cd mvp-copiloto
uv venv --python 3.12 .venv
uv pip install --python .venv -e .

.venv/Scripts/python.exe scripts/baixar_pdfs.py 4
.venv/Scripts/python.exe scripts/ingerir.py
.venv/Scripts/python.exe scripts/testes.py
.venv/Scripts/python.exe -m uvicorn copiloto.pesquisa:app --app-dir src --port 8001
```

Com o acervo já montado, basta dar dois cliques em `rodar.bat`. Ele sobe o app de pesquisa e abre o navegador sozinho. A janela preta precisa ficar aberta enquanto você usa; fechá-la derruba o servidor.

Depois abra `http://127.0.0.1:8001`. O servidor leva uns 30 segundos para subir porque carrega os modelos e pré-carrega as páginas dos PDFs.

O microfone usa o reconhecimento de voz do navegador e só funciona no Chrome e no Edge. O campo de texto funciona em qualquer navegador. Escolha o idioma antes de falar, porque é ele que decide para quais idiomas a frase é traduzida.

## Dois apps

- `copiloto.pesquisa:app` (porta 8001): a página abaixo, `/api/consultar`, `/api/acervo` e `/api/jobs`, sobre o acervo de
  desenvolvimento e sem autenticação. É para os scripts e para medir; nunca vai para um ambiente exposto.
- `copiloto.api:app` (porta 8000, o `/copiloto` do app): só as rotas autenticadas (`/api/acervo/{conta}`,
  `/api/consultar-qualificado`, `/api/votos`) e `/api/saude`. Não carrega o acervo de desenvolvimento e roda no
  contêiner do `Dockerfile` (`docker build -t limmiar-copiloto .` nesta pasta).

Variáveis do app de produto: `COPILOTO_API_URL` (a API do produto, que autoriza cada operação; padrão `http://127.0.0.1:5259`),
`COPILOTO_APP_ORIGEM` (origem do app liberada no CORS; sem ela não há CORS), `COPILOTO_JUIZ_URL`, `COPILOTO_JUIZ_CHAVE`
e `COPILOTO_JUIZ_VERSAO` (ver `tools/juiz/README.md`). O `idioma` da consulta aceita o locale da interface (pt-BR, en-US, es-419, it-IT) e vira pt-BR, en-US ou es; sem acervo nem tradução, en-US. `/api/saude` informa `juiz_llm.versao`, `juiz_llm.no_ar` e `qualificado`.

## A página

Na coluna da esquerda você escolhe um ou vários PDFs, informa idioma e autor (opcional) e clica em Processar. Cada arquivo ganha uma barra de progresso. Quando termina, a obra entra no acervo com o resultado do autoteste dela.

No acervo, as caixas marcadas limitam a busca àquelas obras. Sem nenhuma marcada, a busca usa o acervo inteiro. O x remove a obra e todos os trechos dela.

Na coluna da direita, cada frase falada ou escrita vira um cartão. O cartão mostra as traduções que o sistema usou, quanto tempo cada etapa levou e as três referências encontradas.

## A stack e por que cada peça está lá

Estado de 2026-09-23. Números em `resultados/benchmark-local-2026-09.md`.

| Peça | Escolha | Onde corre | Motivo medido |
|---|---|---|---|
| Leitura do PDF | pypdf + filtro de prosa (`parse.motivo_descarte`) | CPU, na ingestão | o filtro tira tabela, referência, cabeçalho, método e questionário: dev 2290 -> 1707 trechos, teste 1748 -> 1053, 0 positivos sem trecho nas páginas-alvo |
| Embedder | BAAI/bge-m3 fp32 | GPU (`COPILOTO_EMBEDDER_DISPOSITIVO=cuda`, default do `rodar.bat`) ou CPU | 3 consultas em 34 ms na GPU contra 234 ms em CPU; 2,1 GiB de VRAM |
| Tradução | Opus-MT em CTranslate2 int8 | CPU | alimenta o BM25 nos três idiomas |
| Busca | bge-m3 + BM25 + RRF, top 10 com no máximo 4 por obra | CPU + GPU | p50 ~210 ms, p95 ~330 ms |
| Triagem (clínica, risco, ambígua) | regressão logística sobre o vetor bge-m3 da fala (`modelos/juiz-local/triagem/logistica.npz`) | GPU, ~20 ms | AUROC fora-da-parte 0,968 / 0,955 / 0,970; 0 VRAM extra |
| Juiz | gte-multilingual-reranker-base afinado com rótulos do Jev e falas aumentadas (`modelos/juiz-local/gte-r2`) | GPU fp32 | 10 candidatos em 233 ms p50; 1,47 GiB de VRAM; precisão no teste 0,55, abaixo do alvo. O checkpoint `gte-r2` é o artefato usado pelo decisor padrão; rondas posteriores devem ser comparadas no mesmo benchmark antes de substituir o manifesto. |
| Citação | a frase do trecho mais próxima da fala, escolhida por código e conferida no PDF | CPU | existe no PDF por construção |
| Banco | SQLite e numpy | CPU | |
| API | FastAPI | | |

Pico de VRAM do processo: 3,42 GiB. Fala: 0,37 s p50 e 0,59 s p95 do início ao cartão. Fala sem conteúdo clínico: ~20 ms, porque a busca e o juiz não correm.

O fluxo atual é upload -> ingestão -> índice -> fala do paciente e contexto -> triagem -> busca ampla -> juiz em lotes -> todas as fontes pertinentes com citação conferida, ou silêncio com motivo. Não há corte de uma referência por fala. Fala do terapeuta nunca gera cartão; ambiguidade pede clarificação. A seleção literal das citações agrupa a codificação e mantém somente vetores de passagens bibliográficas em um cache de memória limitado; não guarda a consulta clínica.

O decisor escolhe-se em `decisao.decisor()`: `treinado` quando os ficheiros do juiz local existem, senão `jev` (se houver chave) ou `local` (llama-server). `COPILOTO_DECISOR` força um deles. Em produção o Jev não entra: é professor (rótulos de treino) e avaliador (nota em cartões sem rótulo, relatada à parte).

Subir um PDF novo não pede treino: o juiz julga qualquer par fala x trecho. Treinar de novo é um passo ocasional e offline, com `resultados/treinar.bat` (candidatos, rótulos do Jev com cache, falas aumentadas escritas por Claude a partir dos PDFs de dev, triagem, juiz com validação cruzada, limiares no dev, contratos). A medição no teste corre uma vez, com `resultados/avaliar_local_teste.bat`.

## Números atuais

Medidos no acervo de 12 PDFs (4 por idioma, 1355 trechos), em CPU:

| Métrica | Valor | Piso nos testes |
|---|---|---|
| Recall@5 | 0,925 | 0,90 |
| MRR@10 | 0,874 | 0,85 |
| Recall@1 | 0,831 | |
| Sondas cross-lingual | 10/12 = 0,83 | 0,90, e falha |
| Latência p95 da consulta | 240 ms | 400 ms |
| Proveniência conferida | 40/40 | 100% |

O Recall e o MRR vêm de 201 perguntas geradas do próprio texto: uma frase do trecho vira a pergunta, e o trecho é a resposta esperada. Isso é mais fácil que a realidade, porque a pergunta repete as palavras do livro.

As sondas se parecem mais com o uso real. São 12 frases escritas como um paciente falaria, cada uma com o documento que deveria aparecer no top 3. Elas estão em `data/probes.json`. Doze é pouco, e a diferença entre 10 e 11 acertos é uma frase. Para o piso de 0,90 significar alguma coisa, o conjunto precisa de umas 100 frases, de preferência escritas por um psicólogo.

Das duas sondas que falham, uma devolve em 3º lugar um paper de PTSD que o rótulo não aceita (o `en-us-02`). Clinicamente, ele provavelmente serve. O rótulo não foi alterado depois de ver o resultado. A outra falha é real: a frase sobre pular da cadeira com barulho alto devolve relatos de familiares.

## Testes

`scripts/testes.py` testa contratos com duplos no lugar dos modelos, por isso passa com qualquer decisor, e sai com código 1 se algum falhar:

1. o parse preserva página e parágrafo
2. o texto citado existe literalmente na página indicada
3. recall@20 da busca acima do piso
4. o sistema falha para o silêncio (terapeuta, portão ou juiz fora, fala neutra, fala ambígua)
5. só há cartão com citação que existe no trecho e no PDF
6. nota abaixo do limiar do canal não gera cartão
7. a seleção de obras restringe os candidatos
8. contrato da API
9. protocolo do Jev contra servidor simulado (`scripts/teste_jev.py`)
10. o índice usa o mesmo modelo que gerou os trechos
11. decisor treinado: silêncio, canais, clarificação e citação conferida
12. filtro de prosa: referência e tabela caem, prosa clínica fica

A qualidade do decisor real mede-se à parte, no corpus de teste que o treino nunca viu: `avaliar.py correr` e `relatorio` com `COPILOTO_CORPUS=teste`, e depois `portao_qualidade.py`. Os cartões sem rótulo recebem primeiro a nota do Jev como avaliador (`treinar.py avaliador`, campo `cartoes_avaliados_pelo_jev`) e depois o veredito de Claude em `data/avaliacao/teste_adjudicacoes.jsonl` (campo `precisao_so_claude`). Hoje (ronda 3) o juiz local passa em silêncio (0 cartões em neutro e terapeuta, 0,4% em quase acertos) e em ambíguo sinalizado (0,94), e falha em precisão (0,55) e risco sinalizado (0,79).

## Limites conhecidos

O embedding da frase roda no servidor, então o servidor vê a frase em claro.

O pypdf não sabe o layout da página. Em PDF de duas colunas ele pode juntar parágrafos, e isso aparece no autoteste por obra: o `en-us-01` tem Recall@5 de 0,81, contra 1,0 nos outros de inglês. O Docling resolve isso e também devolve a posição do trecho na página.

SQLite com numpy serve até algumas centenas de milhares de trechos. Acima disso, o esquema passa para Postgres com pgvector sem mudar as tabelas.

A ingestão em CPU leva de 15 segundos a 3 minutos por PDF, conforme o tamanho. Em GPU deve ser bem mais rápida, mas isso não foi medido.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `src/copiloto/esquema.py` | tabelas e o tipo `Citacao` |
| `src/copiloto/parse.py` | PDF para blocos com página e parágrafo |
| `src/copiloto/embedder.py` | texto para vetor |
| `src/copiloto/hibrido.py` | BM25 e fusão |
| `src/copiloto/traducao.py` | tradução da frase com CTranslate2 |
| `src/copiloto/busca.py` | índice em memória, consulta e conferência no PDF |
| `src/copiloto/ingestao.py` | pipeline de ingestão e barra de progresso |
| `src/copiloto/avaliacao.py` | perguntas geradas do texto e métricas |
| `src/copiloto/api.py` | HTTP |
| `src/copiloto/web/index.html` | a página |
| `scripts/benchmark*.py`, `scripts/experimento_fusao.py` | as rodadas de comparação |

## Jev pela Vercel AI Gateway

O portão e o juiz podem usar o Jev (TypeSafe AI), servido pela Vercel AI Gateway com o id `typesafe-ai/jev`. O Jev não gera texto: responde a perguntas tipadas com probabilidades calibradas. No copiloto faz três coisas:

1. No portão, diz com que probabilidade a fala é clínica, é de risco ou é ambígua.
2. No juiz, diz para cada um dos 20 candidatos com que probabilidade o trecho descreve o mesmo fenómeno que a fala. Como é barato, julga os 20 de uma vez em vez de 4.
3. Escolhe, entre os 22 fenómenos da taxonomia, qual o paciente está a expressar. É o rótulo que aparece no cartão.

O que o Jev não faz continua fora dele. A citação literal é a frase do trecho mais próxima da fala, escolhida por código com o bge-m3, por isso existe no PDF por construção. Os termos técnicos que alargam a busca continuam a vir do modelo local, quando está no ar.

Para ligar, crie uma chave na Vercel (AI Gateway, API keys) e defina-a no ambiente antes de subir o servidor:

```bash
setx AI_GATEWAY_API_KEY "vck_..."
```

Com a chave definida, o decisor passa a ser o Jev. Sem ela, é o modelo local. Para forçar um dos dois, use `COPILOTO_DECISOR=jev` ou `COPILOTO_DECISOR=local`. Os pedidos seguem com retenção zero de dados (`zeroDataRetention`), mas a fala do paciente sai da máquina para a Vercel e para a TypeSafe.

`scripts/teste_jev.py` verifica o protocolo contra um servidor simulado, sem chave. `scripts/bench_juiz.py jev` mede o Jev nos mesmos 386 pares julgados que os modelos locais.
