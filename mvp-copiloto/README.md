# MVP copiloto Limmiar

Documentação da arquitetura e da integração no produto:

- [Arquitetura, stacks, download e contratos](docs/arquitetura-copiloto.md)
- [Organograma do fluxo](docs/organograma-copiloto.md)
- [Plano de implementação no Limmiar](docs/plano-implementacao-limmiar.md)
- [Fontes oficiais da stack](docs/fontes-stack.md)

Protótipo do copiloto que vai entrar no Limmiar. Você sobe PDFs, fala ou escreve uma frase como um paciente falaria, e o sistema devolve o trecho da literatura que trata daquilo, com obra, autor, página e parágrafo. O texto citado é conferido contra o PDF antes de aparecer na tela.

É busca semântica com um juiz (RAG sem a etapa de geração). O juiz é o `juiz-pequeno-v1` (`juiz_pequeno.py`): um cross-encoder mmBERT-small destilado, em ONNX na CPU, no mesmo processo da busca. Nenhuma API paga nem servidor à parte roda na hora da fala.

Na integração atual, a transcrição envia frases estabilizadas do paciente durante a sessão e cada frase recebe uma
resposta NDJSON de uma linha, com no máximo um cartão. A rota de produto responde 503 até que a versão do juiz
(`data/juiz-pequeno.json`) tenha os cortes `vivencia`, `generico` e `principal` em `data/juiz-v2/registro.jsonl`, e
`/api/saude` diz o motivo. Não há juiz de reserva. O [registro de implementação](docs/plano-implementacao-limmiar.md)
descreve as provas e as pendências atuais.

## Como rodar

```bash
cd mvp-copiloto
uv venv --python 3.12 .venv
uv pip install --python .venv -e .

.venv/Scripts/python.exe scripts/baixar_modelos.py
.venv/Scripts/python.exe scripts/baixar_pdfs.py 4
.venv/Scripts/python.exe scripts/ingerir.py
.venv/Scripts/python.exe scripts/testes.py
.venv/Scripts/python.exe -m uvicorn copiloto.pesquisa:app --app-dir src --port 8001
```

A ingestão precisa do juiz em `modelos/juiz-pequeno`, porque grava a nota `generico` de cada trecho, e do codificador em `modelos/bge-m3`, que `scripts/baixar_modelos.py` baixa na revisão fixada em `embedder.py`. Um `data/acervo.db` sem a coluna `generico`, ou com vetores de outro codificador (`embedder.PADRAO` diferente do gravado em `obra.modelo`), não carrega: apague-o e rode `scripts/ingerir.py` de novo.

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
`COPILOTO_APP_ORIGEM` (origem do app liberada no CORS; sem ela não há CORS). Do juiz: `COPILOTO_JUIZ_DIR` (padrão
`modelos/juiz-pequeno`, com `tokenizer.json` e `onnx/`), `COPILOTO_JUIZ_ONNX` (o arquivo em `onnx/`; padrão
`model_gather.onnx`), `COPILOTO_JUIZ_THREADS` (threads do ONNX Runtime; padrão metade de `os.cpu_count()`) e
`COPILOTO_CANDIDATOS_JUIZ` (candidatos da busca por fala; padrão 24). Do codificador: `COPILOTO_EMBEDDER_DIR` (padrão
`modelos/bge-m3`, com `tokenizer.json` e `onnx/sentence_transformers_int8.onnx`) e `COPILOTO_EMBEDDER_THREADS` (threads do
ONNX Runtime; padrão 0, um por núcleo físico). `/api/saude` informa `qualificado`, `motivo`,
`juiz` (a versão), `promovida` e `limiares`.

## A página

Na coluna da esquerda você escolhe um ou vários PDFs, informa idioma e autor (opcional) e clica em Processar. Cada arquivo ganha uma barra de progresso. Quando termina, a obra entra no acervo com o resultado do autoteste dela.

No acervo, as caixas marcadas limitam a busca àquelas obras. Sem nenhuma marcada, a busca usa o acervo inteiro. O x remove a obra e todos os trechos dela.

Na coluna da direita, cada frase falada ou escrita vira um cartão. O cartão mostra as traduções que o sistema usou, quanto tempo cada etapa levou e as três referências encontradas.

## A stack

| Peça | Escolha | Onde corre |
|---|---|---|
| Leitura do PDF | pypdf com o filtro de prosa (`parse.motivo_descarte`), que tira tabela, referência, cabeçalho, método e questionário | CPU, na ingestão |
| Embedder | bge-m3 em ONNX int8 (`Xenova/bge-m3`, `embedder.py`), sem torch | CPU, no processo |
| Busca | bge-m3 denso sobre a fala (`busca.py`) | CPU |
| Alerta de risco | cabeça linear sobre o vetor bge-m3 da fala (`risco.py`), antes do portão | CPU |
| Juiz | `juiz_pequeno.py`: um cross-encoder com quatro perguntas pelo par que recebe (abaixo) | CPU, no processo |
| Citação | a frase do trecho vencedor de maior nota `principal`, conferida no PDF | CPU |
| Banco | SQLite e numpy | CPU |
| API | FastAPI | |

O fluxo atual é upload -> ingestão (vetor bge-m3 e nota `generico` de cada trecho) -> índice -> fala do paciente -> alerta de risco -> portão `vivencia` -> busca (24 candidatos) -> saem os trechos genéricos -> `principal` em cada um dos outros -> o maior vira cartão se passar do corte -> citação conferida, ou silêncio com motivo. Fala do terapeuta nunca gera cartão. Todo cartão sai com nível `forte`, porque passou o único corte da versão.

## O juiz

Um só ONNX responde às quatro perguntas, e o par diz qual: (fala, trecho) dá `principal`, a nota de o trecho explicar a fala; (pergunta, trecho) dá `generico`, se o trecho só define ou lista; (fala, pergunta) dá `vivencia`, se o paciente fala de si, e `risco`. As perguntas estão em `data/juiz-pequeno.json`, e mudar uma palavra delas muda o juiz. A nota `generico` é calculada uma vez, na preparação do material, e fica na tabela `trecho` ao lado do vetor. Os cortes da versão estão no registro e ainda serão medidos no gabarito com `tools/atendimento-simulado/gold/avaliar_copiloto.py`.

Subir um PDF novo não pede treino, porque o juiz julga qualquer par de fala e trecho.

## Promover uma versão

A regra de promoção não mudou. `scripts/juiz_v2/ciclo.py decidir` compara as previsões do candidato e do juiz ativo em duas réguas. O teste fixo (`teste_fixo.py`, `data/juiz-v2/teste-fixo.jsonl`) só barra regressão. As notas do profissional medem a melhora. `rotulos_5k.py` transforma as notas em `data/juiz-v2/q5k/rotulos-5k-suave-teste.jsonl`, e `avaliar_5k.py` compara as previsões com elas. As previsões da v2 nas duas réguas estão em `data/juiz-v2/ciclo2/`. Para o juiz pequeno, `tools/atendimento-simulado/gold/rotulagem.py RUN` lista os cartões de uma rodada ponta a ponta para o profissional avaliar. Cada versão promovida fica em `data/juiz-v2/registro.jsonl`. A regra completa está em [Ciclo de treino do juiz](../docs/juiz-ciclo-de-treino.md).

## Testes

`scripts/testes.py` testa contratos com duplos no lugar do juiz. Primeiro ele roda `scripts/test_confiabilidade.py`, e sai com código 1 se algum contrato falhar:

1. o parse preserva página e parágrafo
2. o texto citado existe literalmente na página indicada
3. recall@20 da busca acima do piso de 0,50
4. a decisão fica em silêncio para fala do terapeuta, fala sem vivência e nota abaixo do corte, e só mostra cartão com obra, autor, página, parágrafo e citação conferida no trecho e no PDF
5. a seleção de obras restringe os candidatos
6. contrato da API
7. o índice usa o mesmo modelo que gerou os trechos
8. filtro de prosa: referência e tabela caem, prosa clínica fica

Em 2026-10-21 o item 3 falha. Só 83 dos 250 casos de `data/avaliacao/dev_positivos.jsonl` têm o trecho certo entre os 20 candidatos (0,332).

O CI roda os testes de unidade listados em `.github/workflows/copiloto.yml`. A qualidade do juiz mede-se à parte, no gabarito de `tools/atendimento-simulado/gold`.

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
| `src/copiloto/busca.py` | índice em memória, consulta e conferência no PDF |
| `src/copiloto/ingestao.py` | pipeline de ingestão e barra de progresso |
| `src/copiloto/avaliacao.py` | perguntas geradas do texto e métricas do autoteste por obra |
| `src/copiloto/decisao.py` | risco, portão, busca, filtro dos genéricos, cortes e cartão |
| `src/copiloto/juiz_pequeno.py` | o juiz: sessão ONNX, tokenizador e as quatro perguntas |
| `src/copiloto/risco.py` | o alerta de risco |
| `src/copiloto/cascata.py` | a regra da cascata antiga, que só o gabarito ainda usa |
| `src/copiloto/aluno.py` | o aluno gte da cascata antiga, carregado pelo bakeoff e pelo treino do gabarito |
| `src/copiloto/juiz_llm.py` | cliente do servidor do juiz LLM, o professor das ferramentas de treino |
| `src/copiloto/qualificacao.py` | limiar e promoção de cada versão no registro |
| `src/copiloto/juiz.py` | opções e conferência da citação literal |
| `src/copiloto/api.py` | HTTP do app de produto |
| `src/copiloto/pesquisa.py` | HTTP do app de pesquisa |
| `src/copiloto/web/index.html` | a página |
| `scripts/juiz_v2/` | a regra de promoção: `ciclo.py`, `teste_fixo.py`, `avaliar_5k.py` e `rotulos_5k.py` |
