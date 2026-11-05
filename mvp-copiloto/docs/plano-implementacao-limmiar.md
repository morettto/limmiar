# Integração do copiloto no Limmiar

Atualizado em 21/10/2026. O produto local já faz cadastro com senha, TOTP, verificação profissional, cadastro cifrado de pacientes, consentimentos, notas SOAP e transcrição com diarização durante a fala. Este documento registra a integração do copiloto bibliográfico e suas pendências; não declara o juiz clinicamente validado.

## Evidência disponível

- `apps/app/src/features/live-session/SessionReview.tsx` recebe palavras por WebSocket do Nemotron durante a captura, preserva silêncio e pausa/retomada e exige confirmação dos papéis das vozes. A revisão permite editar texto e voz de cada palavra, ouvindo uma reprodução temporária em memória. Qualquer edição invalida a confirmação. Somente snapshots de transcrição são persistidos, cifrados e append-only; adaptadores de gravação/leitura de áudio em OPFS foram removidos.
- `tools/nemotron` executa o runtime oficial NeMo-Speech.cpp com revisão fixa e pesos verificados por SHA-256. Usa Nemotron 3 Diarization, lançado em 23/09/2026, e Nemotron 3.5 ASR. Um áudio de demonstração de 34 segundos produziu palavras, duas vozes e quatro turnos no navegador. A nova execução expôs erros na transcrição em português e uma fronteira de voz antecipada que atribuiu parte de uma frase ao outro locutor. Isso comprova a integração, mas exige revisão e medição de WER/DER antes de depender do texto ou do papel automaticamente.
- O juiz é o `juiz-pequeno-v1`: um cross-encoder mmBERT-small em ONNX, na CPU, no processo do copiloto. Ele abre o portão de vivência, a nota `generico` gravada na preparação tira os trechos que só definem ou listam, e o maior `principal` vira cartão se passar do corte. Os cortes estão registrados e ainda serão medidos; não está promovido. Regra, números e promoção: `docs/juiz-ciclo-de-treino.md` e `data/juiz-v2/registro.jsonl`.
- A rota `/api/consultar-qualificado` responde 503, e `/api/saude` diz o motivo, enquanto falta o corte registrado da versão. Não há juiz de reserva. Cada fala recebe uma linha NDJSON com no máximo um cartão.

## Fluxo do produto

1. O profissional abre um paciente e registra os consentimentos específicos de gravação e análise.
2. O áudio é transmitido ao serviço instalado na mesma máquina, acessível apenas por loopback. A reprodução de revisão é temporária em memória. Nenhum áudio é salvo; o prontuário recebe somente a transcrição cifrada e suas revisões.
3. A diarização produz identificadores anônimos. O profissional confirma a identidade ouvindo a voz e revisa as fronteiras e o texto de cada turno; uma confirmação global da voz não corrige uma palavra atribuída ao locutor errado. Voz desconhecida permanece excluída do copiloto.
4. Frases estáveis de voz explicitamente identificada como paciente enviam texto e até cinco frases anteriores enquanto a captura continua. Pontuação, troca de voz ou pausa estável de 900 ms fecham a frase; palavras da frase seguinte não cancelam sua análise. As cinco frases chegam inteiras à triagem e ao juiz, sem corte silencioso para duas. Identidade e áudio não seguem no pedido. A fala do profissional não gera pedido nem entra nesse contexto. Texto, contexto ou papel corrigido invalidam respostas anteriores.
5. O profissional seleciona explicitamente as obras autorizadas. Seleção vazia significa nenhuma obra; ausência de seleção não deve liberar todo o acervo no produto.
6. O serviço recupera candidatos, tira os genéricos, o juiz dá a nota principal a cada um e o maior decide contra o corte. O trecho vencedor e a citação são conferidos contra a página do PDF. Se qualquer verificação falhar, não apresenta um cartão.
7. Cada referência aprovada mostra fala e contexto que o originaram, citação literal, obra, autor e página. O profissional decide se a referência é pertinente. Não há diagnóstico automático nem conversão de score não calibrado em porcentagem de certeza clínica.
8. A incorporação à nota exige ação do profissional. A nota mantém as âncoras temporais da transcrição e referências da versão aceita; a assinatura segue o fluxo cifrado já existente. Não há gravação histórica para reproduzir.

## Arquitetura e privacidade

O texto decifrado permanece no cliente e no processo local consentido. A API .NET mantém autorização, consentimentos, dados cifrados e assinatura; não recebe transcrição em claro para intermediar inferência. Essa decisão preserva a arquitetura de conhecimento zero existente.

O protótipo Python compartilha um acervo SQLite de demonstração. Ele não é um servidor multiusuário de produção. Antes da integração com dados reais, o serviço local deve receber apenas as obras autorizadas da conta aberta e descartar o contexto ao trocar de paciente, sair ou revogar consentimento. Não copiar o banco global do protótipo para a API hospedada.

Para o desenvolvimento, Vite encaminha `/speech` para o runtime oficial na porta 8080 e `/copiloto` para o protótipo na porta 8000. O pacote instalável definitivo deve supervisionar esses processos locais e exigir uma credencial de sessão entre cliente e serviço. O servidor de produção não deve expor esses proxies.

## Etapas e critérios de aceite

### 1. Concluir a avaliação do juiz e da busca

Responsáveis: `mvp-copiloto/src/copiloto/{busca,decisao,juiz_pequeno}.py` e `tools/atendimento-simulado/gold/`.

- Avaliar candidatos antes do juiz para separar falta de recall de erro de classificação. O histórico encontrou recall de página de 0,97 somente com 200 candidatos; medir novamente no acervo atual antes de mudar o padrão.
- Comparar configuração atual, recuperação ampliada e juízes já treinados. Escolher no conjunto de desenvolvimento; manter o conjunto final sem treinamento nem ajuste de limiar.
- Avaliar cada referência retornada, sem exigir a passagem única do gabarito antigo. Outras obras são válidas quando sustentam o mesmo fenômeno e contexto; semelhança temática isolada não basta. Registrar decisão e justificativa por caso e passagem. Deduplicar somente a mesma passagem, preservando obras independentes. Medir precisão por referência e cobertura por fala.
- Acrescentar diálogos coerentes com pronomes, negação, relato de terceiros, passado versus presente, hipótese versus intenção e fala ambígua. Cada caso precisa de gabarito revisado, com mais de uma âncora válida quando houver fontes equivalentes.
- Registrar versão dos modelos, pesos, código, corpus, PDFs e limiares. Uma avaliação de outra versão não autoriza a atual.
- Manter os limites do contrato S19: precisão com limite estatístico, falsos cartões por categoria, risco, ambiguidade, cobertura e latência. Zero cartões não comprova qualidade nem cobertura.

Aceite: relatório reproduzível da configuração escolhida, gabaritos adjudicados e todos os limites aprovados. Enquanto faltar isso, o juiz permanece experimental e os cartões exigem revisão profissional.

### 2. Contrato real entre transcrição e consulta

Responsáveis: `apps/app/src/features/live-session`, novo cliente da consulta local e contrato bibliográfico em `packages/copilot` apenas quando existir mais de um consumidor.

Contrato: o cliente mantém sessão, paciente, turno e tempos; a inferência recebe apenas papel confirmado, idioma, texto vigente, até cinco falas anteriores e lista de obras autorizadas. A resposta é uma linha NDJSON com no máximo uma referência, com obra, página, passagem e citação literal, e `completo` sempre verdadeiro. O cliente associa o resultado à versão exata da fala. Lista vazia acompanha motivo de silêncio/clarificação.

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

## Execução local atual

Na raiz, `pnpm dev` prepara PostgreSQL, aplica migrações, sobe Nemotron e supervisiona API, interface e serviço bibliográfico. Para executar somente o protótipo:

```powershell
cd mvp-copiloto
# cole aqui as variáveis que ..\tools\juiz\local.ps1 imprime (servidor do juiz)
.venv/Scripts/python.exe -m uvicorn copiloto.api:app --app-dir src --host 127.0.0.1 --port 8000
```

Acompanhe `/api/saude` depois que os modelos carregarem. A avaliação usa casos fictícios:

```powershell
.venv/Scripts/python.exe scripts/test_confiabilidade.py
.venv/Scripts/python.exe ../tools/atendimento-simulado/gold/avaliar_copiloto.py RUN
```

## Fontes oficiais do áudio

- [Nemotron 3 Diarization — modelo, ordem dos canais e lançamento](https://huggingface.co/nvidia/Nemotron-3-Diarization)
- [NeMo-Speech.cpp — guia oficial](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/cli.md)

O objetivo desta sequência é acrescentar o copiloto sobre o fluxo local funcionando, com evidência de pertinência contextual antes de liberar cartões como funcionalidade clínica validada.
