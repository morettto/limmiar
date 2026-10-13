# Serviço do juiz

Gemma 4 E4B + adaptador LoRA (`mvp-copiloto/data/juiz-v2/lora/v2`) servidos pelo vLLM com a API
da OpenAI. O app chama o serviço por `COPILOTO_JUIZ_URL` (`mvp-copiloto/src/copiloto/juiz_llm.py`):
`juiz` dá a nota sim/não de cada trecho; `base` (sem adaptador) reescreve a fala em linguagem de artigo.

## Como replicar para todos os clientes

1. Uma versão do juiz é uma imagem imutável: `limmiar-juiz:<versao>` (pesos base e adaptador dentro), com o vLLM fixo em
   `v0.31.0`. A versão nasce na tag, no `--build-arg VERSAO` e em `ENV LIMMIAR_JUIZ_VERSAO`, e é a mesma que o
   orquestrador recebe em `COPILOTO_JUIZ_VERSAO`.
2. Todas as réplicas rodam a mesma imagem atrás de um balanceador; nenhuma guarda estado.
3. Versão nova: sobe o novo grupo de réplicas, roda `smoke.py`, passa o tráfego aos poucos e mantém o
   grupo anterior até confirmar; voltar é trocar o apontamento.
4. Só vira imagem, e só é liberada pelo orquestrador, uma versão promovida no teste fixo
   (`docs/juiz-ciclo-de-treino.md`) e registrada em `mvp-copiloto/data/juiz-v2/registro.jsonl`.

## Construir e rodar

O Gemma tem licença com aceite: aceite-a na página do modelo com a conta dona do token. O token entra só no
build, como secret (não fica em camada nem em variável da imagem). Da raiz do repositório, numa máquina com Docker:

```bash
HF_TOKEN=... docker build -f tools/juiz/Dockerfile --secret id=hf,env=HF_TOKEN \
  --build-arg ADAPTADOR=mvp-copiloto/data/juiz-v2/lora/v2 --build-arg VERSAO=v2 -t limmiar-juiz:v2 .
docker run -d --gpus all -e VLLM_API_KEY="$K" -p 8000:8000 limmiar-juiz:v2
COPILOTO_JUIZ_URL=http://127.0.0.1:8000 COPILOTO_JUIZ_CHAVE="$K" python tools/juiz/smoke.py
```

- `Dockerfile.dockerignore` (o Docker o lê ao lado do Dockerfile quando se usa `-f`) deixa entrar no contexto só
  `adapter_config.json` e `adapter_model.safetensors` de cada adaptador.
- A chave vem de `VLLM_API_KEY` na execução. Sem ela o contêiner não sobe, em vez de servir aberto. O vLLM só
  autentica `/v1`, `/v2` e `/inference`; `/health` (usado pelo `HEALTHCHECK`) fica aberto, então a porta continua atrás
  de TLS e de rede restrita.
- `--gpu-memory-utilization` é argumento do `docker run` (padrão 0.90). Com o modelo de busca na mesma GPU, use
  `docker run ... limmiar-juiz:v2 --gpu-memory-utilization 0.80`; com 0.70 não sobra memória para o cache.
- Construa numa máquina diferente da que está treinando.

## Ambiente de teste

O juiz de teste roda numa GPU da Fly (`deploy/fly.toml`): HTTPS e chave de API na frente, e a máquina para sozinha quando
ninguém usa. É a mesma conta e o mesmo `flyctl` da API (`docs/ambiente-de-teste.md`). A Vast serve para treinar, não para servir.
Só dados sintéticos: a GPU fica fora do Brasil e isso é transferência internacional pela LGPD (D3 do plano).

Passos, da raiz do repositório, com `flyctl auth login` feito:

```bash
flyctl apps create limmiar-juiz-teste
K=$(openssl rand -hex 32); echo "$K"   # guarde: é o COPILOTO_JUIZ_CHAVE do orquestrador
flyctl secrets set VLLM_API_KEY="$K" -a limmiar-juiz-teste
HF_TOKEN=... VERSAO=v2 bash tools/juiz/deploy/publicar.sh
```

Depois do deploy, o orquestrador recebe `COPILOTO_JUIZ_URL=https://limmiar-juiz-teste.fly.dev`, `COPILOTO_JUIZ_CHAVE=$K` e
`COPILOTO_JUIZ_VERSAO=v2` (`docs/ambiente-de-teste.md`). Para conferir:

```bash
JUIZ=limmiar-juiz-teste.fly.dev
curl -fsS https://$JUIZ/health
COPILOTO_JUIZ_URL=https://$JUIZ COPILOTO_JUIZ_CHAVE=$K python tools/juiz/smoke.py
```

- Cada sessão de teste começa acordando o juiz: `until curl -fsS https://$JUIZ/health; do sleep 10; done`. O vLLM só abre a
  porta depois de carregar o modelo, então a primeira resposta leva alguns minutos e o timeout de 20 s do orquestrador
  não a espera.
- Versão nova: `VERSAO=v3 ADAPTADOR=<pasta> bash tools/juiz/deploy/publicar.sh`, depois `COPILOTO_JUIZ_VERSAO=v3` no orquestrador.
- Se a Fly não tiver GPU livre ou o tamanho `l40s` mudar de nome (`flyctl platform vm-sizes`), o mesmo contêiner roda em
  qualquer GPU com Docker: `docker run --gpus all -e VLLM_API_KEY="$K" -p 8000:8000 limmiar-juiz:v2` atrás de um proxy
  com TLS (Caddy, por exemplo), e a máquina é desligada na mão.
- Custo: a GPU cobra por hora ligada e quase nada parada; o que pesa é esquecer de a deixar ligada por um fluxo longo.

## Servir na GPU local (llama-server)

O mesmo juiz roda na GPU do usuário (GTX 1660 Super, 6 GB) com o llama.cpp b11500 compilado para CUDA 12.4 (a build 13.4 falha no
driver 591.86). O servidor carrega um único modelo, o Gemma 4 E4B Q4_K_M, e o adaptador sem aplicar (`--lora-init-without-apply`).
Quem liga o adaptador é o pedido: `juiz_llm.py` manda `"lora": [{"id": 0, "scale": 1.0}]` ao julgar e `scale: 0.0` no portão e na
reescrita. O vLLM ignora esse campo e escolhe o adaptador pelo nome do modelo, então o cliente é o mesmo nos dois servidores.

Uma vez, da raiz do repositório (config e tokenizer do Gemma são públicos; os pesos não são baixados):

```powershell
$g = '.local\llamacpp\gemma-4-E4B-it-cfg'; New-Item -ItemType Directory -Force $g | Out-Null
foreach ($f in 'config.json','generation_config.json','tokenizer.json','tokenizer_config.json','chat_template.jinja') {
  curl.exe -sL -o "$g\$f" "https://huggingface.co/google/gemma-4-E4B-it/resolve/main/$f" }
curl.exe -sL -o .local\llamacpp\llama.zip https://github.com/ggml-org/llama.cpp/archive/refs/tags/b11500.zip
Expand-Archive .local\llamacpp\llama.zip .local\llamacpp\src -Force
mvp-copiloto\.venv\Scripts\python.exe .local\llamacpp\src\llama.cpp-b11500\convert_lora_to_gguf.py --base $g `
  --outfile mvp-copiloto\modelos\gguf\juiz-v2-lora-f16.gguf --outtype f16 mvp-copiloto\data\juiz-v2\lora\v2
```

Para subir, na janela onde vai rodar o `pnpm dev`:

```powershell
.\tools\juiz\local.ps1                 # imprime as linhas $env:COPILOTO_JUIZ_* ; cole-as nesta janela
mvp-copiloto\.venv\Scripts\python.exe tools\juiz\smoke.py
```

- `-Ngl` (padrão 99, tudo na GPU) é o número de camadas na GPU; baixe-o se a VRAM não bastar. Contexto 3072, uma vaga (`-np 1`), a
  chave de API é gerada se `COPILOTO_JUIZ_CHAVE` não estiver definida. O servidor escuta só em `127.0.0.1:8100`.
- Há um modelo só no servidor (`--alias juiz`); por isso o script imprime `COPILOTO_BASE_MODELO` e `COPILOTO_REESCRITA_MODELO` iguais a `juiz`.
- O log do servidor fica em `.local/juiz-local.log`. Encerrar: `Stop-Process -Id <pid>` (o script imprime o pid).

## Contrato de privacidade

Sem log do corpo das requisições (`--no-enable-log-requests`), sem disco de dados, TLS e chave de API
na frente. Recebe texto da fala e trechos candidatos, nunca áudio nem PDF inteiro.

## Variáveis do orquestrador

`COPILOTO_JUIZ_URL`, `COPILOTO_JUIZ_CHAVE`, `COPILOTO_JUIZ_VERSAO`, `COPILOTO_JUIZ_MODELO` (`juiz`),
`COPILOTO_REESCRITA_MODELO` (`base`), `COPILOTO_CANDIDATOS_JUIZ` (40). Não há mais teto de cartões por fala: os
candidatos são todos julgados, e as faixas `forte`/`possivel` vêm do registro da versão.

## Não verificado ainda

O caminho local (`local.ps1`) não foi executado: a conversão do adaptador para GGUF, o carregamento do E4B com o LoRA no llama-server,
a VRAM, a latência e a concordância das probabilidades com as do vLLM (`ciclo2/v2-fixo.previsoes.jsonl`) estão por medir. O campo
`lora` por pedido (conhecido da documentação do servidor) e `--lora-init-without-apply` (visto na ajuda do b11040) não foram exercitados no b11500. A
sintaxe do script foi conferida pelo parser do PowerShell; os testes do cliente (`test_juiz_llm.py`) cobrem o campo `lora`. O vLLM
aceitar o campo `lora` sem recusá-lo também não foi testado.

A imagem não foi construída nem executada (sem Docker com GPU na máquina de desenvolvimento). Conferidos só no código
do vLLM `v0.31.0`: a existência da tag `vllm/vllm-openai:v0.31.0`, `VLLM_API_KEY` como fonte da chave, `/health`
fora da autenticação e `--no-enable-log-requests` (o vLLM 0.31 não tem mais `--disable-log-requests`). O comando
do vLLM, sem esses dois itens, foi verificado numa RTX 3090 Ti com `--gpu-memory-utilization 0.80`. Falta construir a
imagem e rodar `smoke.py` nela. O caminho da Fly (`deploy/`) também não foi executado: a existência da GPU `l40s`
na Fly, o nome do tamanho em `fly.toml`, o limite de tamanho da imagem (pesos dentro, dezenas de GB) e a parada
automática com a porta só abrindo depois do carregamento vêm da documentação, não de uma execução.
