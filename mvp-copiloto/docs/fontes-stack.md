# Fontes oficiais — stack do MVP copiloto

Pesquisa curta, baseada em fontes primárias consultadas em 2026-09-29. Os comandos abaixo assumem um ambiente virtual Python e usam `./modelos/` como diretório local. Para produção, fixe versões de pacotes e uma revisão/commit dos modelos.

## Resumo

| Componente | URL oficial | Download | Carregamento local | Licença declarada | Ponto de atenção |
|---|---|---|---|---|---|
| `BAAI/bge-m3` | [model card](https://huggingface.co/BAAI/bge-m3) | `snapshot_download(repo_id="BAAI/bge-m3", local_dir="./modelos/bge-m3")` | `SentenceTransformer("./modelos/bge-m3", local_files_only=True)` | MIT | 1024 dimensões, até 8192 tokens; os modos dense/sparse/ColBERT têm custos e APIs diferentes. |
| `Alibaba-NLP/gte-multilingual-reranker-base` | [model card](https://huggingface.co/Alibaba-NLP/gte-multilingual-reranker-base) | `snapshot_download(repo_id="Alibaba-NLP/gte-multilingual-reranker-base", local_dir="./modelos/gte-reranker")` | `AutoModelForSequenceClassification.from_pretrained(..., trust_remote_code=True, local_files_only=True)` | Apache-2.0 | 306M parâmetros, até 8192 tokens, mais de 70 idiomas; requer código remoto confiável e avaliação de latência. |
| Hugging Face `transformers` | [documentação](https://huggingface.co/docs/transformers/en/installation) / [repositório](https://github.com/huggingface/transformers) | `pip install "transformers[torch]"` | `AutoTokenizer/AutoModel*.from_pretrained("./modelos/...", local_files_only=True)` | Apache-2.0 | O pacote não define a licença dos checkpoints; `trust_remote_code=True` executa código do repositório do modelo. |
| `sentence-transformers` | [documentação](https://www.sbert.net/docs/installation.html) / [repositório](https://github.com/huggingface/sentence-transformers) | `pip install -U sentence-transformers` | `SentenceTransformer("./modelos/...", local_files_only=True)` | Apache-2.0 | A documentação recomenda Python 3.10+, PyTorch 2.2+ e Transformers 5.0+; alinhar isso com o modelo usado. |
| CTranslate2 | [documentação](https://opennmt.net/CTranslate2/) / [repositório](https://github.com/OpenNMT/CTranslate2) | `pip install ctranslate2` | `ctranslate2.Translator("./modelos/opus-mt-en-de", device="cpu")` | MIT | Modelo precisa estar no formato CTranslate2; tokenização/detokenização fica fora do runtime. GPU usa CUDA 12.x nas wheels Linux/Windows. |
| OPUS-MT | [projeto](https://github.com/Helsinki-NLP/Opus-MT) / [modelo](https://huggingface.co/Helsinki-NLP/opus-mt-en-de) | baixar um par de idiomas específico, por exemplo `Helsinki-NLP/opus-mt-en-de` | `AutoModelForSeq2SeqLM.from_pretrained("./modelos/opus-mt-en-de", local_files_only=True)` ou converter para CTranslate2 | CC-BY-4.0 no modelo `en-de` | É tradução por par de idiomas; o próprio projeto informa ausência de controle de qualidade além de avaliação automática. |
| FastAPI | [documentação](https://fastapi.tiangolo.com/) / [repositório](https://github.com/fastapi/fastapi) | `pip install "fastapi[standard]"` | `fastapi run main.py` ou `uvicorn main:app`; a aplicação define `app = FastAPI()` | MIT | HTTPS, reinícios, replicação e memória são responsabilidades de implantação; vários workers podem duplicar modelos em RAM. |

## Detalhes por componente

### 1. `BAAI/bge-m3`

- **URL oficial:** [Hugging Face — BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3); o model card aponta o código para [FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding).
- **Como baixar:** `huggingface_hub.snapshot_download(repo_id="BAAI/bge-m3", local_dir="./modelos/bge-m3")`. A documentação do Hub/Transformers recomenda `snapshot_download` para preparar uso offline ([Transformers — instalação/offline](https://huggingface.co/docs/transformers/en/installation)).
- **Como carregar localmente — embeddings densos:**

  ```python
  from sentence_transformers import SentenceTransformer

  model = SentenceTransformer("./modelos/bge-m3", local_files_only=True)
  embeddings = model.encode(["texto de teste"])
  ```

  O próprio model card documenta `SentenceTransformer("BAAI/bge-m3")` para embeddings densos.
- **Requisitos relevantes:** vetor de 1024 dimensões e comprimento máximo de 8192 tokens; o card documenta suporte a mais de 100 idiomas. `FlagEmbedding` é o caminho documentado para obter também pesos lexicais/sparse e vetores multi-vector/ColBERT.
- **Licença:** MIT, conforme o campo `License` do model card.
- **Limitações de produção:** entradas longas aumentam memória e latência; o card recomenda reduzir `max_length` quando não for necessário e observa que BM25 continua competitivo em recuperação de documentos longos. Se o MVP usar somente `sentence-transformers`, não assumir que os modos sparse/ColBERT estão cobertos pela mesma chamada de embedding denso.

### 2. `Alibaba-NLP/gte-multilingual-reranker-base`

- **URL oficial:** [Hugging Face — Alibaba-NLP/gte-multilingual-reranker-base](https://huggingface.co/Alibaba-NLP/gte-multilingual-reranker-base).
- **Como baixar:** `huggingface_hub.snapshot_download(repo_id="Alibaba-NLP/gte-multilingual-reranker-base", local_dir="./modelos/gte-reranker")` ([modo offline do Transformers](https://huggingface.co/docs/transformers/en/installation)).
- **Como carregar localmente:**

  ```python
  from transformers import AutoModelForSequenceClassification, AutoTokenizer

  path = "./modelos/gte-reranker"
  tokenizer = AutoTokenizer.from_pretrained(path, local_files_only=True)
  model = AutoModelForSequenceClassification.from_pretrained(
      path,
      trust_remote_code=True,
      local_files_only=True,
  )
  model.eval()
  ```

  O model card documenta `transformers>=4.36.0`, `AutoModelForSequenceClassification` e `trust_remote_code=True`.
- **Requisitos relevantes:** 306M parâmetros, máximo de 8192 tokens e mais de 70 idiomas; `xformers`/unpadding são recomendados pelo card para aceleração.
- **Licença:** Apache-2.0, conforme o model card.
- **Limitações de produção:** é um reranker de pares, não um substituto direto do embedding denso; batch size, truncamento e uso de GPU precisam ser medidos. Como o carregamento exige código remoto, a documentação do Transformers recomenda revisar e fixar um commit específico ao usar `trust_remote_code=True` ([carregamento de modelos customizados](https://huggingface.co/docs/transformers/models)).

### 3. Hugging Face `transformers`

- **URL oficial:** [documentação de instalação](https://huggingface.co/docs/transformers/en/installation), [carregamento de modelos](https://huggingface.co/docs/transformers/models) e [repositório](https://github.com/huggingface/transformers).
- **Como baixar:** `pip install "transformers[torch]"`. Para um checkpoint, usar `snapshot_download` e registrar uma revisão do Hub.
- **Como carregar localmente:**

  ```python
  from transformers import AutoTokenizer, AutoModel

  path = "./modelos/checkpoint"
  tokenizer = AutoTokenizer.from_pretrained(path, local_files_only=True)
  model = AutoModel.from_pretrained(path, local_files_only=True)
  ```

  `from_pretrained` aceita diretório local; `HF_HUB_OFFLINE=1` ou `local_files_only=True` impede novas chamadas ao Hub. Para o reranker GTE, usar a classe/head do model card, não `AutoModel` genérico.
- **Requisitos relevantes:** o código atual do projeto declara Python 3.10–3.14 e dependência opcional de PyTorch; aceleração GPU depende da instalação compatível de PyTorch/CUDA ([`setup.py`](https://github.com/huggingface/transformers/blob/main/setup.py)).
- **Licença:** Apache-2.0 para a biblioteca ([LICENSE](https://github.com/huggingface/transformers/blob/main/LICENSE)); cada checkpoint deve ser verificado separadamente.
- **Limitações de produção:** pesos, tokenizer, configuração, backend e licença vêm do checkpoint, não apenas da biblioteca. A documentação alerta que modelos customizados com `trust_remote_code=True` podem executar código do repositório; revisar e fixar o commit antes de empacotar.

### 4. `sentence-transformers`

- **URL oficial:** [documentação](https://www.sbert.net/docs/installation.html), [API `SentenceTransformer`](https://www.sbert.net/docs/package_reference/sentence_transformer/model.html) e [repositório](https://github.com/huggingface/sentence-transformers).
- **Como baixar:** `pip install -U sentence-transformers`; o construtor aceita um model ID do Hub. Para uma cópia explícita e offline, usar `snapshot_download`.
- **Como carregar localmente:**

  ```python
  from sentence_transformers import SentenceTransformer

  model = SentenceTransformer(
      "./modelos/bge-m3",
      local_files_only=True,
      device="cuda",  # ou "cpu"
  )
  ```

  A API aceita caminho local, `local_files_only`, `device`, `backend` e `trust_remote_code`; `save_pretrained` grava o diretório para recarga.
- **Requisitos relevantes:** a documentação atual recomenda Python 3.10+, PyTorch 2.2+ e Transformers 5.0+; GPU/CUDA requer PyTorch instalado para a combinação CUDA da máquina ([instalação](https://www.sbert.net/docs/installation.html)).
- **Licença:** Apache-2.0, conforme o [repositório oficial](https://github.com/huggingface/sentence-transformers) e o anúncio oficial de continuidade do projeto ([Hugging Face](https://huggingface.co/blog/sentence-transformers-joins-hf)).
- **Limitações de produção:** o layout salvo inclui módulos e configurações, não apenas um arquivo de pesos; todos os arquivos devem ser distribuídos para o modo offline. Modelos com módulos customizados exigem revisão de código e `trust_remote_code=True`. Fixar a matriz `sentence-transformers`/Transformers/modelo é especialmente importante porque a documentação atual recomenda Transformers 5.0+, enquanto o card do GTE documenta `transformers>=4.36.0`.

### 5. CTranslate2

- **URL oficial:** [documentação](https://opennmt.net/CTranslate2/) e [repositório](https://github.com/OpenNMT/CTranslate2).
- **Como baixar/instalar:** `pip install ctranslate2`. Para converter um checkpoint OPUS-MT do Hub, o quickstart oficial usa:

  ```text
  ct2-transformers-converter --model Helsinki-NLP/opus-mt-en-de --output_dir ./modelos/opus-mt-en-de
  ```

- **Como carregar localmente:**

  ```python
  import ctranslate2

  translator = ctranslate2.Translator(
      "./modelos/opus-mt-en-de",
      device="cpu",  # ou "cuda"
  )
  ```

  O quickstart oficial mostra `translate_batch`; a tokenização e a detokenização são feitas fora do CTranslate2, normalmente com SentencePiece.
- **Requisitos relevantes:** wheels Python para Linux x86-64/AArch64, macOS x86-64/ARM64 e Windows x86-64; Python >=3.9; pip >=19.3. As wheels Linux/Windows usam CUDA 12.x para GPU; Windows pode exigir o Visual C++ runtime.
- **Licença:** MIT ([LICENSE](https://github.com/OpenNMT/CTranslate2/blob/master/LICENSE)).
- **Limitações de produção:** a conversão é uma etapa de build e deve ser reproduzível com o mesmo checkpoint/tokenizer; o runtime não resolve tokenização. É necessário testar a combinação de arquitetura, quantização, CPU/GPU e versão de CUDA no ambiente final.

### 6. OPUS-MT

- **URLs oficiais:** [projeto e serviços](https://github.com/Helsinki-NLP/Opus-MT), [catálogo de modelos](https://github.com/Helsinki-NLP/OPUS-MT-train/tree/master/models) e exemplo concreto [Helsinki-NLP/opus-mt-en-de](https://huggingface.co/Helsinki-NLP/opus-mt-en-de).
- **Como baixar:** escolher o par de idiomas no catálogo ou no Hub; por exemplo, `snapshot_download(repo_id="Helsinki-NLP/opus-mt-en-de", local_dir="./modelos/opus-mt-en-de")`. Para uso com CTranslate2, converter esse diretório/model ID com `ct2-transformers-converter`.
- **Como carregar localmente com Transformers:**

  ```python
  from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

  path = "./modelos/opus-mt-en-de"
  tokenizer = AutoTokenizer.from_pretrained(path, local_files_only=True)
  model = AutoModelForSeq2SeqLM.from_pretrained(path, local_files_only=True)
  ```

  O model card também registra pré-processamento com normalização + SentencePiece.
- **Requisitos relevantes:** modelo específico por par de idiomas; SentencePiece para a segmentação; CTranslate2 somente após conversão para o formato próprio.
- **Licença:** o exemplo `opus-mt-en-de` declara CC-BY-4.0; o catálogo de modelos também declara CC-BY-4.0. A licença do código do repositório de serviços é separada e não substitui a licença dos pesos.
- **Limitações de produção:** o projeto informa que os modelos atuais foram treinados sem filtragem, data augmentation ou domain adaptation e sem controle de qualidade além de avaliação automática; versões de desenvolvimento podem ser experimentais/de baixa qualidade. O model card também registra riscos de vieses e limitações de tradução. Validar cada par de idiomas e carregar a atribuição CC-BY-4.0.

### 7. FastAPI

- **URL oficial:** [documentação](https://fastapi.tiangolo.com/) e [repositório/metadata](https://github.com/fastapi/fastapi/blob/master/pyproject.toml).
- **Como baixar/instalar:** `pip install "fastapi[standard]"` (ou `uv add "fastapi[standard]"`). O extra standard inclui o CLI/Uvicorn e dependências comuns; a base depende de Starlette e Pydantic.
- **Como carregar/rodar localmente:** em `main.py`, definir `app = FastAPI()` e iniciar com `fastapi run main.py`; alternativamente, `uvicorn main:app`. O resultado é um servidor HTTP local, não um modelo carregado pelo FastAPI.
- **Requisitos relevantes:** o `pyproject.toml` atual declara Python >=3.10, Starlette >=0.46.0 e Pydantic >=2.9.0.
- **Licença:** MIT, declarada no `pyproject.toml` e no [LICENSE](https://github.com/fastapi/fastapi/blob/master/LICENSE).
- **Limitações de produção:** a documentação trata HTTPS, startup, reinícios, replicação e memória como decisões de implantação. Cada worker é um processo e pode carregar sua própria cópia dos modelos em RAM; definir o número de workers conforme a memória disponível e usar proxy/terminação TLS, supervisão e observabilidade adequados.

## Fontes oficiais principais

- [BGE-M3 model card](https://huggingface.co/BAAI/bge-m3)
- [GTE multilingual reranker model card](https://huggingface.co/Alibaba-NLP/gte-multilingual-reranker-base)
- [Transformers — instalação/offline](https://huggingface.co/docs/transformers/en/installation)
- [Transformers — carregamento de modelos](https://huggingface.co/docs/transformers/models)
- [Sentence Transformers — instalação](https://www.sbert.net/docs/installation.html)
- [CTranslate2 — instalação](https://opennmt.net/CTranslate2/installation.html)
- [CTranslate2 — quickstart](https://opennmt.net/CTranslate2/quickstart.html)
- [OPUS-MT — repositório](https://github.com/Helsinki-NLP/Opus-MT)
- [OPUS-MT — modelo `en-de`](https://huggingface.co/Helsinki-NLP/opus-mt-en-de)
- [FastAPI — deployment concepts](https://fastapi.tiangolo.com/deployment/concepts/)
