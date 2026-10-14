# Integração do copiloto no Limmiar

Atualizado em 03/10/2026. O produto local já faz cadastro com senha, TOTP, verificação profissional, cadastro cifrado de pacientes, consentimentos, notas SOAP e transcrição com diarização durante a fala. Este documento registra a integração do copiloto bibliográfico e suas pendências; não declara o juiz clinicamente validado.

## Evidência disponível

- `apps/app/src/features/live-session/SessionReview.tsx` recebe palavras por WebSocket do Nemotron durante a captura, preserva silêncio e pausa/retomada e exige confirmação dos papéis das vozes. A revisão permite editar texto e voz de cada palavra, ouvindo uma reprodução temporária em memória. Qualquer edição invalida a confirmação. Somente snapshots de transcrição são persistidos, cifrados e append-only; adaptadores de gravação/leitura de áudio em OPFS foram removidos.
- `tools/nemotron` executa o runtime oficial NeMo-Speech.cpp com revisão fixa e pesos verificados por SHA-256. Usa Nemotron 3 Diarization, lançado em 23/09/2026, e Nemotron 3.5 ASR. Um áudio de demonstração de 34 segundos produziu palavras, duas vozes e quatro turnos no navegador. A nova execução expôs erros na transcrição em português e uma fronteira de voz antecipada que atribuiu parte de uma frase ao outro locutor. Isso comprova a integração, mas exige revisão e medição de WER/DER antes de depender do texto ou do papel automaticamente.
- Os testes de `scripts/test_confiabilidade.py` verificam contexto, falante desconhecido, formato estrito do juiz, limites de confiança e proveniência integral dos trechos.
- A execução HTTP multirreferência `resultados/http-final100_verificado-20261002T005238Z/resumo.json` mediu 100 casos: 67 referências em 38 falas, nenhuma referência nos 40 negativos e p95 de 4.734 ms. As 43 passagens fora do gabarito foram revistas semanticamente por Codex, com decisão e justificativa vinculadas aos hashes da fala/contexto e da passagem em `data/avaliacao/final100_adjudicacoes_codex.jsonl`. A revisão automatizada classificou 48/67 referências como pertinentes (71,6%) e 19 como incompatíveis; 31/60 falas positivas receberam ao menos uma referência pertinente. Isso não é certificação clínica e ainda reprova o objetivo de precisão. A régua aceita fontes equivalentes de outras obras; não confunde ausência no gabarito com erro.
- As falhas observadas incluem inferir regulação emocional quando a fala só distingue intenção suicida, associar medo de morrer a luto por morte violenta de terceiros e confundir solidão subjetiva com distanciamento social na pandemia. Corrigir com pares contextualizados no desenvolvimento; não usar o conjunto final para treinar, escolher modelo ou ajustar limiar.
- O juiz agora recebe a fala, seu contexto e a passagem completos, sem o corte de 256 tokens/900 caracteres. Lotes longos são processados um par por vez; texto além da capacidade do modelo retorna 422, sem truncar a fala em silêncio. O teste real de cinco pares com 1.411 tokens usou 0,63 GiB de VRAM. A comparação `bench-juiz-dev-texto-completo-*.jsonl` usa pares históricos de desenvolvimento, que podem ter participado do treino; serve para diagnóstico e não prova generalização.
- A nova execução HTTP `resultados/http-final100_verificado-20261002T135601Z/revisao-semantica-codex.json`, com textos completos e os mesmos limiares, retornou 70 referências: 52 pertinentes, 18 incompatíveis, nenhuma pendente após revisão automatizada e nenhuma referência nas 40 falas negativas. Precisão semântica de 74,3%, cobertura de 32/60 falas positivas e p95 de 3.947 ms. As revisões têm hashes e justificativas em `data/avaliacao/final100_adjudicacoes_codex_20261002.jsonl`. O juiz continua reprovado para o objetivo de precisão.
- A tentativa de exigir aprovação do mesmo classificador para a passagem e para a citação isolada foi medida em 313 pares históricos de desenvolvimento (`resultados/dev-validacao-citacao-gte-r2.jsonl`). Reduziu o recall de 59,7% para 36,1%, sem ganho estatístico de precisão: o limite inferior de Wilson caiu de 95,5% para 94,3%. Essa condição adicional não foi incorporada ao produto.
- `scripts/treinar.py` agora preserva passagens completas e o contexto dos exemplos, confere booleanos estritos, vincula a adjudicação ao texto efetivamente revisado e aplica o último grupo de gradientes mesmo quando o lote de acumulação fica incompleto. A retomada exige hashes iguais de dados, código e configuração; resultados anteriores não são reutilizados em silêncio. O treino contextual usa os rótulos duros e mantém variantes da mesma fala na mesma parte.
- `scripts/gerar_contextos_dev.py` produziu 1.000 contrastes sintéticos a partir de âncoras de desenvolvimento com proveniência conferida, sem ler arquivos finais ou de teste. A medição direta do classificador em `resultados/bench-contextos-dev-gte-r2.resumo.json` aprovou 146/250 relatos diretos e 109/250 elipses pertinentes; também aprovou indevidamente 43/250 citações negadas como experiência própria e 35/250 relatos atribuídos a terceiros. Essa medição isola o juiz, sem triagem, busca ou certificação clínica. O treino `gte-contexto` começa no modelo base, separado dos pesos ativos, e ainda exige validação fora da parte antes de substituir o produto.
- O relatório histórico `resultados/gates-s19-2026-09-29.json` reprovou a qualidade do juiz e o recall do recuperador. A integração Nemotron agora existe, mas os demais critérios exigem novas medições.
- A calibração fora-da-parte de `gte-contexto` não encontrou limiar com limite inferior de Wilson de 95%. A inspeção encontrou também fontes alternativas pertinentes rotuladas como negativas por ausência entre as âncoras indicadas. `gte-contexto-revisado` excluiu esses pares sem revisão, conservou negativos de fala e adjudicações explícitas e agrupou variantes do mesmo caso. As três partições e o treino final terminaram; não substituíram o modelo ativo.

Atualização de 3 de outubro: as três partições revisadas terminaram. A calibração
somente no desenvolvimento selecionou `0.964`: 1.881/1.959 pares aprovados
corretos, precisão de 96,02%, limite inferior de Wilson de 95,06% e recall de
88,06% dos pares positivos. Os 226 contrastes de citação e os 226 de terceiros
não produziram aprovação. São medições fora-da-parte de desenvolvimento,
sem certificação clínica ou liberação do produto.

O treino final terminou. `scripts/qualificar_revisado.py` congelou
um protocolo de 200 casos independentes: 80 positivos, 80 neutros, 20 quase
acertos, 10 falas de terapeuta e 10 ambiguidades. Os hashes das obras do corpus
de teste não se sobrepõem aos do desenvolvimento. O limiar foi congelado antes
de qualquer inferência desse conjunto; fontes alternativas precisam de revisão
semântica, e o relatório nunca escreve uma aprovação de produção automaticamente.
A avaliação mede primeira decisão, primeiro cartão e conclusão de todas as fontes.

A execução foi interrompida depois do primeiro caso: retornou 746 referências,
com primeira fonte em 5.276,5 ms e conclusão em 476.506,3 ms. Quatro passagens
revisadas sobre consumo de crack não sustentam entorpecimento após uma morte;
as outras 742 não foram adjudicadas. O diagnóstico é `FAIL_PARCIAL`, sem
estimativa de precisão para o conjunto completo e sem publicação dos pesos.
Não ajustar a régua por esse caso nem incorporá-lo ao treino.

A auditoria encontrou somente 31 das 979 falas com fonte positiva acompanhadas
de uma fonte incorreta explicitamente revisada. A primeira correção acrescentou
74 revisões de desenvolvimento, de 63 casos em três idiomas: 67 incompatíveis
e sete alternativas pertinentes. A carga confere os hashes da consulta e da
passagem e substitui o rótulo anterior da mesma fonte. A calibração agora exige
também limite inferior de Wilson de 95% especificamente nos contrastes de
documento para a mesma fala; resultados antigos sem essa marcação não servem
para aprovar novo treino. A amostra continua insuficiente para declarar qualidade.

Na medição diagnóstica de 134 pares, o revisado aprovou 89 no limiar congelado
de 0.964, incluindo 24 fontes incompatíveis. O GTE base aprovou zero nesse
limiar; o Qwen base aprovou 15, com uma incompatível. Positivos canônicos podem
ter participado do treino, portanto essa comparação serve para identificar a
falha, sem estimar generalização ou escolher um limiar de produção. Nenhum
dos modelos foi liberado.

A seleção de citações passou a agrupar a codificação e reutilizar somente
vetores de passagens bibliográficas em um cache de memória limitado. Na amostra
de 20 fontes, preservou as mesmas citações literais: 19,2 segundos sequenciais,
11 segundos no primeiro lote e 178 ms com fontes já codificadas. Não guarda
consultas de paciente nesse cache. Isso mede somente a seleção da citação;
latência do insight completo ainda precisa ser aprovada.

`fontes-progressivas-v3` vincula a versão também ao índice bibliográfico real.
Mudança em código, PDFs, pesos ou banco invalida o serviço qualificado até nova
inicialização e prova correspondente. O monitor verifica os artefatos entre
lotes; erro interrompe o fluxo e retira resultados parciais no cliente.
- A seleção do produto percorre todo o acervo autorizado, sem top 10 nem quota de quatro passagens por obra. O juiz avalia lotes de oito e a rota qualificada transmite um lote por resposta NDJSON, com conclusão ou cursor assinado para continuar. Falas novas têm prioridade entre lotes; as já iniciadas alternam os lotes restantes sem reiniciar a varredura. O cliente reúne as fontes aprovadas. Correções invalidam resultados e continuação. Isso prova o mecanismo de entrega, não o acerto do juiz ou sua latência clínica.
- A rota `/api/consultar-qualificado` exige relatório independente correspondente aos pesos, código, corpus e limiares ativos; retorna 503 enquanto falta essa prova. Nenhum arquivo PASS foi criado para contornar a reprovação. Os testes do protocolo usam duplos explicitamente; o modelo real ainda precisa aprovar o gate.

## Fluxo do produto

1. O profissional abre um paciente e registra os consentimentos específicos de gravação e análise.
2. O áudio é transmitido ao serviço instalado na mesma máquina, acessível apenas por loopback. A reprodução de revisão é temporária em memória. Nenhum áudio é salvo; o prontuário recebe somente a transcrição cifrada e suas revisões.
3. A diarização produz identificadores anônimos. O profissional confirma a identidade ouvindo a voz e revisa as fronteiras e o texto de cada turno; uma confirmação global da voz não corrige uma palavra atribuída ao locutor errado. Voz desconhecida permanece excluída do copiloto.
4. Frases estáveis de voz explicitamente identificada como paciente enviam texto e até cinco frases anteriores enquanto a captura continua. Pontuação, troca de voz ou pausa estável de 900 ms fecham a frase; palavras da frase seguinte não cancelam sua análise. As cinco frases chegam inteiras à triagem e ao juiz, sem corte silencioso para duas. Identidade e áudio não seguem no pedido. A fala do profissional não gera pedido nem entra nesse contexto. Texto, contexto ou papel corrigido invalidam respostas anteriores.
5. O profissional seleciona explicitamente as obras autorizadas. Seleção vazia significa nenhuma obra; ausência de seleção não deve liberar todo o acervo no produto.
6. O serviço recupera candidatos, aplica o juiz e verifica a citação inteira contra a página do PDF. Se qualquer verificação falhar, não apresenta um cartão.
7. Cada referência aprovada mostra fala e contexto que o originaram, citação literal, obra, autor e página. O profissional decide se a referência é pertinente. Não há diagnóstico automático nem conversão de score não calibrado em porcentagem de certeza clínica.
8. A incorporação à nota exige ação do profissional. A nota mantém as âncoras temporais da transcrição e referências da versão aceita; a assinatura segue o fluxo cifrado já existente. Não há gravação histórica para reproduzir.

## Arquitetura e privacidade

O texto decifrado permanece no cliente e no processo local consentido. A API .NET mantém autorização, consentimentos, dados cifrados e assinatura; não recebe transcrição em claro para intermediar inferência. Essa decisão preserva a arquitetura de conhecimento zero existente.

O protótipo Python compartilha um acervo SQLite de demonstração. Ele não é um servidor multiusuário de produção. Antes da integração com dados reais, o serviço local deve receber apenas as obras autorizadas da conta aberta e descartar o contexto ao trocar de paciente, sair ou revogar consentimento. Não copiar o banco global do protótipo para a API hospedada.

Para o desenvolvimento, Vite encaminha `/speech` para o runtime oficial na porta 8080 e `/copiloto` para o protótipo na porta 8000. O pacote instalável definitivo deve supervisionar esses processos locais e exigir uma credencial de sessão entre cliente e serviço. O servidor de produção não deve expor esses proxies.

## Etapas e critérios de aceite

### 1. Concluir a avaliação do juiz e da busca

Responsáveis: `mvp-copiloto/src/copiloto/{busca,treinado,decisao,juiz}.py` e `scripts/avaliar_http.py`.

- Avaliar candidatos antes do juiz para separar falta de recall de erro de classificação. O histórico encontrou recall de página de 0,97 somente com 200 candidatos; medir novamente no acervo atual antes de mudar o padrão.
- Comparar configuração atual, recuperação ampliada e juízes já treinados. Escolher no conjunto de desenvolvimento; manter o conjunto final sem treinamento nem ajuste de limiar.
- Avaliar cada referência retornada, sem exigir a passagem única do gabarito antigo. Outras obras são válidas quando sustentam o mesmo fenômeno e contexto; semelhança temática isolada não basta. Registrar decisão e justificativa por caso e passagem. Deduplicar somente a mesma passagem, preservando obras independentes. Medir precisão por referência e cobertura por fala.
- Acrescentar diálogos coerentes com pronomes, negação, relato de terceiros, passado versus presente, hipótese versus intenção e fala ambígua. Cada caso precisa de gabarito revisado, com mais de uma âncora válida quando houver fontes equivalentes.
- Registrar versão dos modelos, pesos, código, corpus, PDFs e limiares. Uma avaliação de outra versão não autoriza a atual.
- Manter os limites do contrato S19: precisão com limite estatístico, falsos cartões por categoria, risco, ambiguidade, cobertura e latência. Zero cartões não comprova qualidade nem cobertura.

Aceite: relatório reproduzível da configuração escolhida, gabaritos adjudicados e todos os limites aprovados. Enquanto faltar isso, o juiz permanece experimental e os cartões exigem revisão profissional.

### 2. Contrato real entre transcrição e consulta

Responsáveis: `apps/app/src/features/live-session`, novo cliente da consulta local e contrato bibliográfico em `packages/copilot` apenas quando existir mais de um consumidor.

Contrato: o cliente mantém sessão, paciente, turno e tempos; a inferência recebe apenas papel confirmado, idioma, texto vigente, até cinco falas anteriores e lista de obras autorizadas. A resposta transmite referências aprovadas por lote, cada uma com obra, página, passagem e citação literal. O cliente associa o resultado à versão exata da fala. Lista vazia acompanha motivo de silêncio/clarificação; `completo` distingue continuação de encerramento. O cursor contém posição e assinatura e vincula consulta, seleção de obras, versão e limiares; não contém o texto do paciente. Reinício o invalida. Três artigos e dois livros pertinentes permanecem juntos, sem escolher somente o maior score.

Aceite: testes reais de dois pacientes simultâneos não misturam contexto, uma edição de papel invalida o cartão anterior, cancelamento ignora respostas atrasadas e repetição do mesmo turno não duplica cartão. Usar a inferência real instalada, sem adapter falso para demonstrar aprovação.

### 3. Acervo consentido e isolado por conta

Responsáveis: fluxo de seleção e ingestão de PDFs no cliente, serviço local e índice local existente no protótipo.

Aceite: PDF original e página sustentam a citação integral; exclusão ou alteração da obra invalida o índice e cartões correspondentes; troca de conta não reutiliza índice, contexto ou chaves; `obras_ids=[]` nunca consulta o acervo inteiro. O servidor hospedado armazena apenas versões cifradas.

### 4. Cartões na sessão e incorporação à nota

Responsáveis: `SessionReview`, editor SOAP existente e `entities/nota`.

Aceite: durante a revisão temporária, o profissional pode escutar a fala pelo tempo indicado, ler a fonte e aceitar ou descartar a referência. Depois de salvar, permanece a transcrição e suas âncoras temporais. Nenhuma frase nova é assinada automaticamente. Revisão aceita é salva antes da assinatura; erro de rede permite repetir a assinatura sem duplicar a revisão.

### 5. Empacotamento e operação

Responsáveis: inicialização local, supervisão dos modelos, saúde e testes de carga.

Aceite: instalação reproduzível, modelos com revisão e hash fixos, processo saudável antes de aceitar consultas, fila limitada, cancelamento, limite de memória e latência medidos na máquina alvo. Registrar somente contagens, duração e falhas técnicas; não registrar fala, áudio, nomes, chaves ou prompts em telemetria.

ASR/diarização por streaming foram exercitados em navegador e serviço reais com fixture sintética: palavras e duas vozes chegaram durante a fala, com pausa/retomada, salvamento de texto e reabertura sem áudio. Ainda é necessário medir WER/DER em sessões humanas e a latência da primeira fonte qualificada com os modelos e o acervo finais.

O mecanismo de continuação passou em 59 testes focados do app, 28 regressões
Python e três testes de assinatura/vínculo do cursor. A suíte completa do app
passou 973 testes com 100% nas quatro métricas, além de build, lint e arquitetura.
Um E2E com navegador, API, banco e captura Nemotron reais exibiu cinco referências
durante a gravação em 19,9 segundos. As referências dessa prova foram fixtures
interceptadas no navegador; esse E2E valida composição e continuidade da fila,
sem qualificar o juiz nem simular aprovação do serviço real.

## Execução local atual

Na raiz, `pnpm dev` prepara PostgreSQL, aplica migrações, sobe Nemotron e supervisiona API, interface e serviço bibliográfico. Para executar somente o protótipo:

```powershell
cd mvp-copiloto
$env:COPILOTO_EMBEDDER_DISPOSITIVO='cpu'
$env:COPILOTO_JUIZ_DISPOSITIVO='cuda'
$env:COPILOTO_JUIZ_DTYPE='float16'
.venv/Scripts/python.exe -m uvicorn copiloto.api:app --app-dir src --host 127.0.0.1 --port 8000
```

Acompanhe `/api/saude` depois que os modelos carregarem. A avaliação usa casos fictícios:

```powershell
.venv/Scripts/python.exe scripts/test_confiabilidade.py
.venv/Scripts/python.exe scripts/avaliar_http.py
```

O próximo treino depende de ampliar os contrastes de documento revisados no
desenvolvimento. Use uma configuração nova e execute as três partições;
os nomes anteriores não podem retomar com dados ou código alterados.
`scripts/test_fontes_dev.py` e `scripts/test_calibrar_contexto.py` verificam
esse contrato. A aprovação independente continua obrigatória antes de alterar
os pesos e os limiares ativos.

## Fontes oficiais do áudio

- [Nemotron 3 Diarization — modelo, ordem dos canais e lançamento](https://huggingface.co/nvidia/Nemotron-3-Diarization)
- [NeMo-Speech.cpp — guia oficial](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/cli.md)

O objetivo desta sequência é acrescentar o copiloto sobre o fluxo local funcionando, com evidência de pertinência contextual antes de liberar cartões como funcionalidade clínica validada.
