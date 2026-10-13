# Sessão ao vivo

`SessionReview` abre o microfone somente após consentimento de captura. A análise
também exige seu consentimento específico. `transcrever-ao-vivo` manda o PCM ao serviço de
transcrição (`shared/audio/transcricao-servidor`, WebSocket `/speech`): o áudio sai do aparelho
só em memória e nunca é gravado (`docs/adr/ADR-0012-transcricao-no-servidor.md`).

`shared/audio/capturar-pcm` recebe PCM mono do AudioWorklet em `realtime-pcm.processor`.
O protocolo transmite PCM16 e só a fala (a porta de voz descarta o silêncio longo, `shared/audio/README.md`); pausa desabilita a pista
do microfone e preserva o relógio. O encerramento aguarda a cauda do worklet e a
confirmação final do servidor (`commit`). Abort, falha e desmontagem encerram o hardware.

As respostas são snapshots completos de palavras, incluindo hipóteses, com o falante anônimo
(`speaker_N`) que o servidor atribui na sessão presencial e a fronteira estável dele. Uma
hipótese substitui a anterior. Queda do socket e atraso chegam no mesmo snapshot (`aviso`) e a
tela os mostra sem parar a gravação; a reconexão e o deslocamento do relógio estão em
`shared/audio/README.md`. Quem é o profissional vem do aparelho: `vozes-dos-falantes` recorta
do PCM recente (anel de 60 s, em memória) os trechos de cada falante (a primeira janela das palavras finais e, depois, as já estáveis), mede a voz com o
TitaNet do cadastro de voz e guarda a soma dos embeddings normalizados (`vozes`); `identificar-vozes`
compara esse centroide com o perfil cifrado, aberto somente no navegador, com o mesmo limiar do cadastro
(`LIMIAR_MESMA_VOZ`, em `@limmiar/diarization`). Cada voz é julgada sozinha: a que casa é o profissional, as demais são
"Paciente" (ou "Pessoa 2", "Pessoa 3" quando são várias) e duas vozes do servidor que casam são ambas o profissional.
Depois de uma queda os falantes ganham ids novos (o servidor numera de novo) e
se identificam um a um. Voz sem papel decidido ainda não produz insight, mas o texto dela nunca aparece como "não identificado":
antes de qualquer confirmação a primeira voz é provisoriamente o profissional e as outras são pacientes; depois que uma voz é
confirmada como profissional, toda voz nova já entra como paciente. O texto muda de coluna quando o TitaNet decide. Cada voz nova
é verificada com a primeira janela de ~2 s das palavras finais (o mínimo do extrator), sem esperar o servidor fechar o falante,
e na frente das verificações que só refinam; a soma dos embeddings estáveis substitui essa janela depois. Palavra ainda sem
falante fica no bloco atual. Correção manual prevalece sobre novas
respostas automáticas e a revisão do texto continua explícita. Transcrever um arquivo
(`transcrever-local`) usa o mesmo serviço, empurrando o PCM sem esperar o relógio, e deixa os papéis
para a escolha à mão. Na teleconsulta (`transcrever-online`) há uma sessão por trilha WebRTC, sem
separação de vozes, e o papel sai da trilha.

A transcrição aparece em blocos contínuos (`entities/insight/blocos-transcricao`): as frases seguidas da mesma pessoa
ficam num balão só e o balão só quebra quando outra pessoa fala. O profissional fica à direita, o paciente à esquerda,
cada balão com o nome e o instante (m:ss) em que começou; a hipótese do servidor (`delta`) entra na hora no fim do balão
atual, em tom mais claro, e vira texto final no próximo `completed`.

`LiveInsights` seleciona falas estáveis do paciente e envia texto e contexto ao
serviço bibliográfico local. Fontes chegam progressivamente em lotes. Atualizar
texto, contexto ou papel invalida a resposta anterior e cancela a hipótese
substituída. Não há limite de uma obra ou um cartão.

Cada cartão vem com `nivel`. Os fortes aparecem abertos no balão; os possíveis ficam num
`<details>` fechado, "Possíveis: confira antes de usar". A fala que só tem possíveis (sem
esclarecimento nem alerta de risco) ganha um sublinhado pontilhado, mais leve que o tracejado
dos fortes. Votos "útil / não útil" e "Escolher referência" valem nos dois níveis, e o voto grava
a versão `juiz` da resposta.

Três mensagens para três falhas. HTTP 503: "Copiloto não liberado", sem nova tentativa.
Rede, prazo ou 5xx: "Serviço do copiloto fora do ar. Tentando de novo.", com espera crescente
na fila, e o aviso some na primeira resposta boa. Erro no stream ou resposta inválida: a linha
da fala mostra "Esta fala ficou sem análise." (falha só da passada sobre a fala inteira não
marca as frases, que já foram analisadas).

A fila preserva a ordem das frases pendentes. Depois de cada lote, a continuação
volta ao fim da fila: novas falas e fontes restantes recebem sua vez mesmo
durante fala contínua. Correção invalida a versão antiga, encerra sua consulta e
enfileira a nova; encerrar a sessão apaga consultas e progresso em memória.

O MediaRecorder fornece somente uma reprodução temporária para revisão, limitada
a 64 MiB em memória. Blob e URL são descartados ao sair, salvar ou descartar.
Não há escrita de áudio em OPFS, IndexedDB, API, banco ou volume de container.
Os adaptadores antigos de persistência de chunks e leitura de sessão do disco
foram removidos.

`SessionReview` pertence a uma sessão (`atendimentoId`, de `entities/atendimento`): a
transcrição única da sessão usa esse id como `transcriptId` e correções são revisões
dela. Há uma gravação por sessão: com `transcricao` (a última revisão salva) a tela abre
com ela, sem nova captura nem upload, e só as revisões dessa sessão aparecem em
"Revisões e correções". Escolher entre sessões é da pasta do paciente, não daqui.

Salvar acrescenta um snapshot de transcrição cifrado sob a DEK do paciente:
texto, palavras, tempos, papéis, revisão, autor e data. Correções acrescentam
revisões e conflitos de sequência são verificados. O histórico reabre apenas
texto; não recria reprodução de áudio.

Uma fonte pode ser proposta à nota depois de salvar a revisão atual da
transcrição. Captura em andamento, alteração pendente e retirada de consentimento
impedem essa transferência. Abrir o balão não altera o prontuário: a escolha
abre uma confirmação no editor, que confere novamente frase, papel, tempos,
revisão e paciente. O profissional revisa o texto antes de salvar ou assinar.
A referência pertence à nota da mesma sessão; "Ver fala da referência" volta à aba dos
insights dela.

Cada fonte do balão tem os botões "Útil" e "Não útil" (`aria-pressed`, o voto
pode mudar). O voto é sempre gravado no aparelho por `entities/insight/voto-store`.
Na primeira votação sem escolha de consentimento, uma pergunta ("Enviar" /
"Só neste aparelho") grava a escolha; com "sim" o voto vai ao servidor por
`entities/insight/voto-envio`, e pendentes são reenviados a cada voto e ao abrir a
sessão. Sem `votos` (conta e chave) os botões não aparecem.
