# Passagem para o Codex (13/10/2026)

Estado do trabalho feito com o Claude Code no branch `codex/copiloto-mvp`, retomado pelo Codex em 13/10/2026.
Durante a validação do Codex, outra atividade criou commits no branch, até `7ca43a9`, incluindo as duas correções abaixo.
O Codex não executou commit nem push nesta retomada. Leia `AGENTS.md` antes de tudo.

## Decisões do dono (valem como requisito)

- Transcrição fluida e em **tempo real** em qualquer aparelho e navegador (PC, tablet, celular; Zen/Firefox incluídos). "Gravar e
  transcrever depois" está descartado.
- **Saber quem fala é obrigatório.** Profissional à direita, paciente à esquerda; texto contínuo, só quebra quando muda o falante.
- O áudio pode passar pelo servidor **sem ser gravado** (só memória). O texto vai ao juiz. A impressão de voz do profissional vai
  ao gateway por sessão, só em memória.
- Votos útil/não útil vão ao servidor com consentimento e alimentam o retreino do juiz.
- Modelo do juiz: **Gemma 4 E4B + LoRA v2** (o E2B foi treinado e perdeu em todas as medidas). Transcrição: **Nemotron 3.5
  streaming via NeMo-Speech.cpp 0.2.0**. Cloudflare só para o app (o Workers AI não roda modelo próprio hoje).
- Deploy é o último passo. Construir imagens de produção só depois de tudo aprovado.

## Arquitetura da transcrição (pronta e medida)

```
navegador ─WS /speech/v1/fala─▶ gateway de fala (apps/gateway-fala) ─WS─▶ NeMo-Speech 0.2.0 (N containers)
  porta de voz corta o silêncio   Pyannote separa trechos; TitaNet ancora vozes        Nemotron 3.5 ASR, sem diarização
```

- App: `apps/app/src/shared/audio/{transcricao-servidor,porta-de-voz,mapa-de-tempo,capturar-pcm,realtime-pcm.processor}.ts`,
  UI em `features/live-session` e `entities/insight/blocos-transcricao.ts`.
- Gateway: `apps/gateway-fala/src` (pool de instâncias `pool.ts`, identidade por trecho acústico, só envia o que é novo, rotação da
  sessão upstream a cada ~3 min). Protocolo para o app: `parcial {texto}`, `final {frase, falante, palavras}`, `falante`, `concluida`.
- Serviço: `tools/nemotron/{Dockerfile,garantir.mjs,README.md}`. Imagens `limmiar-nemotron:0.2.0-cpu` e `-cuda` saem do
  Dockerfile (pacote oficial com SHA-256). CPU: 2 containers fixos em 2 núcleos cada; GPU: `NEMOTRON_DISPOSITIVO=cuda`.
- Medição anterior à correção de identidade de 13/10 (diálogo de 43 s com gabarito): palavra até a tela mediana −0,03 s / pior 0,32 s (1 sessão); 98,4% de acerto
  de falante; rótulo ~1,1 s após a frase; silêncio de 30 s não trava. Nuvem: uma RTX A4000 (US$ 0,09/h) aguentou 64 sessões
  estáveis. Detalhes e armadilhas (ggml disputa núcleos, `--threads` = vagas HTTP, `state_arena_slots`) no README do nemotron.

## Juiz e copiloto

- `mvp-copiloto/` (Python). Juiz local: `tools/juiz/local.ps1` (llama.cpp, LoRA v2 em GGUF); o dono roda o script com `!`
  porque o classificador de permissões bloqueia executar binário baixado. Registro de versões: `mvp-copiloto/data/juiz-v2/registro.jsonl`.
- Ciclo de retreino e regra de promoção: `docs/juiz-ciclo-de-treino.md`, `mvp-copiloto/scripts/juiz_v2/ciclo.py` (votos
  separados por obra para medir a melhora).

## Como subir local

`pnpm dev` (Docker Desktop aberto). Para o juiz: rodar `tools/juiz/local.ps1` antes, com `COPILOTO_JUIZ_CHAVE` igual nos dois
lados, e exportar `COPILOTO_JUIZ_URL/CHAVE/VERSAO/MODELO`, `COPILOTO_BASE_MODELO`, `COPILOTO_REESCRITA_MODELO` antes do
`pnpm dev`. Aprovar conta: `LIMMIAR_API_URL=http://127.0.0.1:5259 LIMMIAR_STAFF_API_KEY=<StaffAccess.ApiKey de .local/settings.json>
node tools/approve-local.mjs <email>` (depois de enviar o documento na interface). Guia: `docs/guia-teste-manual.md`.
Feche jogos (VALORANT) antes de medir: eles disputam CPU/GPU e contaminam as medições.

## Verificado por último

Validação repetida pelo Codex em 13/10/2026:

- App: `tsc -b`, lint (sem erros, com avisos), `lint:arch`, `check:i18n-complete`, build e `check:bundle` passaram.
- App: `pnpm --filter app test:unit --maxWorkers=2`, 1.941 testes, cobertura 100% em linhas, funções, ramos e instruções.
- Gateway: typecheck, lint e 111 testes, cobertura 100%.
- API .NET: `dotnet test apps/api/Api.sln -c Release --no-restore`, 908 testes, sem ignorados, cobertura 100%.
- Python do copiloto: todos os 148 testes em `scripts/test_*.py` passaram; os 109 da lista do CI também passaram.
- E2E: 61 testes passaram em 2,6 min, com dois workers, `E2E_API_PORTA=55259` e `E2E_PG_PORTA=55432`.
  Banco dedicado: container `limmiar-codex-e2e`, Postgres 17, publicado só em `127.0.0.1:55432`.
- Atendimento completo: 17 passos passaram; relatório em `apps/app/test-results/atendimento-simulado/relatorio.md`.
  ASR, respostas do juiz e acervo remoto são simulados. Não comprova qualidade dos modelos nem voz humana/4G.

Correções feitas na retomada: comentário de configuração do Playwright reduzido a duas linhas para passar o lint;
teste de `PatientList` passou a esperar o término da abertura da carteira, além da chamada da API, evitando uma corrida
com a descriptografia assíncrona. Nenhuma mudança de comportamento do produto.

Aviso do restore da API: `NU1903` em `SSH.NET 2025.1.0`, dependência transitiva da infraestrutura de testes.
A atualização dessa dependência não foi incluída nesta validação. Logs completos em `.local/codex-*.log`.

## Pendente

1. Teste do dono com voz humana no Zen, depois celular e 4G.
2. Suíte E2E concluída na retomada do Codex. Repetir os testes afetados se houver novas mudanças.
3. Revisar os commits criados pela outra atividade e preparar o PR conforme autorização do dono.
   Os pesos `*.safetensors` estão no `.gitignore`. A atualização desta passagem ainda não foi commitada pelo Codex.
4. Deploy (por último): app na Cloudflare; GPU para Nemotron + gateway e para o juiz em São Paulo (AWS `g6.xlarge` foi a
   recomendação de `docs/hospedagem-nemotron-juiz.md`).
5. Reforço de vocabulário clínico por sessão (`speech_contexts` do NeMo-Speech) para precisão; não implementado.

## Ajustes após o teste humano no Zen — 13/10/2026

- Captura PCM e conexão abrem em paralelo; áudio inicial fica em memória até a conexão estar pronta. Perfil de voz é antecipado.
- Tempo de fala soma os intervalos das palavras, excluindo silêncio; tempos de reprodução e citações permanecem canônicos.
- Histórico tem linhas, contraste e espaçamento próprios. `Encerrar sessão` exige revisão da transcrição, salva o rascunho e registra encerramento cifrado. Não assina a nota.
- Upload inicia preparação em segundo plano, com estado e animação. Autorizar só altera permissão; obras prontas são escolhidas na sessão e a seleção fica na transcrição cifrada.
- Preparo do PDF libera a trava do modelo entre lotes de oito trechos, permitindo consultas entre lotes.
- Juiz estava qualificado. Ausência de obras autorizadas era uma causa de ausência de referências; interface agora explica e orienta seleção.

Provas atuais: app com 1.984 testes e cobertura 100%; build, tipos, lint, arquitetura, traduções e orçamento de bundle passaram. Python: 153 testes passaram após o ajuste final dos lotes. E2E geral: 60 passaram, incluindo atendimento completo e chamadas; o cenário antigo de referência sem obras foi atualizado e passou na repetição, totalizando os 61 cenários. A carga das bibliotecas Python ficou bloqueada temporariamente na consulta WMI do Windows; concluiu depois, sem alteração nas dependências.

Docker informa engine funcionando. O contexto `desktop-linux` ficou sem responder; comandos desta execução usam `DOCKER_HOST=npipe:////./pipe/docker_engine`, sem mudar a configuração global.

Ambiente local reiniciado com sucesso: app 5173, API/banco 5259, gateway 8090, ASR 8081/8082, copiloto 8000 e juiz 8100. `/api/saude` confirmou `qualificado=true`, juiz v2 no ar. A carga dos modelos terminou depois da espera na consulta do Windows. Arquivos temporários de cobertura ficaram no workspace porque a revisão automática bloqueou a exclusão; não são arquivos do produto.

Auditoria de criptografia, somente leitura: senha e sal derivado do e-mail geram a chave de conta; ela abre as chaves individuais dos pacientes e fica em memória durante login. Prontuário, transcrição, nota, perfil de voz e materiais persistem cifrados. Exceção encontrada: feedback consentido do juiz (`data/votos/votos.jsonl`) persiste fala/contexto/citação em texto aberto. Também há processamento de áudio/texto decifrados em RAM nos serviços, conforme arquitetura vigente. Não existe bloqueio por inatividade. A auditoria não verificou backups, swap ou toda a infraestrutura.

Pendências: repetir voz humana no Zen para medir a latência inicial, celular/4G e deploy. Nenhum commit ou deploy feito nesta rodada. Não afirmar latência instantânea com base nos testes simulados.

## Documentos de referência

## Preparo lento de PDF — ajuste de 13/10/2026

O dono relatou cinco minutos sem avanço visível em um PDF de 2,6 MB. O serviço estava criando embeddings bge-m3 na CPU. Não foi obtida uma cópia decifrada desse PDF para medir suas etapas; o tempo exato do livro ainda requer repetição humana.

- Progresso real por páginas lidas e textos únicos processados, com contagem, percentual e barra. O acompanhamento consulta o estado a cada segundo; o servidor só incrementa após concluir trabalho.
- Agrupamento por tamanho reduz preenchimento inútil nos lotes. Trechos idênticos são codificados uma vez, mantendo todas as ocorrências, páginas, parágrafos e vetores na ordem original.
- GPU usa FP16 no modelo; saída continua float32. CPU preserva FP32. A versão expõe `dtype_embedder` para rastrear a configuração. Inferência é aquecida antes de publicar o serviço como pronto.
- Eventos estruturados `material_preparation_progress`, `material_prepared` e `material_prepare_failed` registram contagens, dispositivo e tempo de leitura/embeddings. Não registram texto, títulos, autores ou tokens.
- Configuração desta máquina em `.local/settings.json`: `COPILOTO_EMBEDDER_DISPOSITIVO=cuda` e `HF_HUB_OFFLINE=1`, usando pesos já instalados. `tools/dev.mjs` respeita a configuração local. Nenhuma chamada ao repositório de modelos é necessária nesse modo; os pesos precisam estar previamente instalados.

Medição sintética, 32 trechos e 25 textos únicos: original CPU 10,553 s; agrupamento CPU 5,820 s; agrupamento/GPU aquecida 5,069 s (2,08× contra original). No agrupamento CPU, diferença máxima dos vetores 8,20e-8. Comparação CPU/GPU do produto escalar mínimo 0,99978584; não equivale a avaliação clínica completa nem a medição do PDF do dono.

Provas: 39 testes do acervo, cobertura 100% no arquivo afetado; 158 testes Python; dois E2E de consulta/referência aprovados, incluindo barra de progresso. Build, lint sem erros, arquitetura, traduções e orçamento de bundle passaram. CSS 7.137 B gzip (teto 7.200); entrada 240.515 B gzip (teto 247.000).

Ambiente reiniciado; `/api/saude` deve indicar `dispositivo_embedder=cuda`, `dtype_embedder=float16`, juiz v2 qualificado/no ar. O preparo continua somente em RAM: reinício exige preparar novamente os materiais guardados. Sem commit ou deploy nesta rodada. A meta de segundos para um livro completo permanece sem prova nesse hardware.

`docs/plano-fechamento-v1.md`, `docs/pesquisa-nemotron-asr-escala.md`, `docs/hospedagem-nemotron-juiz.md`,
`docs/analise-asr-celular.md`, `docs/adr/ADR-0012-transcricao-no-servidor.md`, `tools/nemotron/README.md`,
`apps/gateway-fala/` (código e testes), `docs/guia-teste-manual.md`.


## Continuação Codex — identidade de voz presencial (13/10/2026)

Relato humano: duas pessoas no mesmo microfone, identidades Pessoa 4/Pessoa 5 e
paciente incorreto. Diagnóstico: um embedding por frase ASR inteira, cadastro de
novas vozes sem confirmação, herança temporal em frases curtas e renumeração de
paciente confirmado na interface.

Corrigido: Pyannote/sherpa-onnx no pool CPU existente, janelas <=10 s; cada intervalo
é medido independentemente com TitaNet, sem confiar no número local do cluster.
Perfil profissional permanece âncora imutável; variantes apenas com confirmação.
Primeira nova voz consistente após reconhecer profissional recebe paciente, outras
IDs distintos. Duas amostras de 1,5 s confirmam nova identidade; trecho curto,
mistura ou sobreposição continua incerto. Palavras incertas podem ser corrigidas
por novo contexto acústico próprio dentro da janela, nunca pela voz vizinha.
Online mantém papéis autenticados. UI preserva Paciente e mostra Voz não identificada;
vozes adicionais não alimentam insights como paciente automaticamente.

Áudio e impressões só em RAM, zerados ao terminar. Modelo público do segmentador
baixado e verificado por hash no setup e na imagem; nenhuma gravação humana salva.
Nova configuração obrigatória GATEWAY_FALA_SEGMENTACAO, automática em pnpm dev/Docker.

Provas: gateway 127 testes e interface 1.984 testes, ambos cobertura 100%; tipos,
compilação, traduções e orçamento de bundle aprovados. Nova fixture TTS de duas
vozes cobre separação real, troca abrupta incerta e áudio vazio. Medição sintética
12 janelas/30 intervalos: 21 corretos, 9 incertos, 0 errados, média 252 ms/máximo
315 ms em CPU. Não é medição de pessoas, microfone compartilhado nem concorrência.

Pendente: repetir teste humano com duas vozes e ruído/pausas; confirmar papéis ao
salvar. Identificação perfeita em sobreposição não foi prometida. Sem commit/deploy.

Teste pela conexão WebSocket real, ASR e gateway nativos: fixture TTS de 10 s, 13 palavras, duas vozes corretamente atribuídas, nenhum ID extra, nenhuma palavra incerta e ordem temporal preservada. Abertura pronta em 16 ms; não inclui inicialização dos serviços nem comprova pessoas reais.

Fechamento automático: dois E2E completos passaram (consulta até nota assinada e referência aprovada reaberta em navegador limpo); lint/arquitetura/traduções passaram sem erros. Ambiente local no ar: app 5173, API 5259, gateway 8090, copiloto 8000 e juiz 8100, todos respondendo; embedder CUDA float16 e juiz qualificado. Teste humano presencial ainda pendente.


## Rodada de testes solicitada pelo dono — serviços pausados

Todos os serviços do Limmiar foram encerrados a pedido do dono. Não reiniciar automaticamente.
Somente o banco isolado de E2E e processos de teste foram usados temporariamente e encerrados.
Prova final: nenhuma porta de uso/teste, processo relacionado ou container Limmiar/Nemotron ativo.

Gerados 3 E2E novos (acervo, ausência de obras com fala e voz/encerramento/histórico), ampliado
referencia-aprovada para seleção de 1 entre 2 obras e persistência após novo login; geradas 4
integrações novas (2 gateway/rede/modelos reais, 2 HTTP/jobs/PDF com embedding determinístico).
Reutilizados unitários já completos; não duplicar testes que só repetem a implementação.

Resultado final: 64 E2E passaram, sem ignorados; app 1.984 testes e gateway 129 testes, ambos
cobertura 100%; 121 testes leves Python passaram. Workflows incluem integração HTTP, preparação
verificada dos modelos nativos e preparação do WASM no E2E manual com cache. CI remoto não rodado.

Matriz e comandos: docs/superpowers/plans/2026-10-13-testes-regressoes-contexto.md.
Sem commit/deploy. Voz humana/Zen/4G e qualidade clínica do juiz seguem sem prova nesta rodada.
