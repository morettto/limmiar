# Sessão online privada

**Objetivo:** ligar dois participantes por áudio WebRTC, sem identidade do paciente nem retenção de áudio, e integrar as duas trilhas à transcrição cifrada e ao copiloto existente.

**Contrato:** `docs/v1-criterios-de-aceite.md`; vault `Limmiar/Specs/S06 Diarização e transcrição canônica.md`, seção Solução (teleconsulta usa origem da faixa de áudio).

**Arquitetura:** servidor ASP.NET oferece somente convites e sinalização WebSocket; mídia usa RTCPeerConnection/DTLS-SRTP. Convite é uma capacidade aleatória com validade e papel imutável. Criação exige profissional ativo e prontuário próprio. Sala e sinalização são transitórias; encerramento apaga as capacidades. Transcrição executa na máquina do profissional, em duas entradas separadas do Nemotron, sem atribuir a fala pelo conteúdo. As chaves e o salvamento continuam no cliente existente.

## 1. Sinalização e autorização

- [ ] `Features/OnlineSessions`: criar sala por `/accounts/{accountId}/patients/{patientId}/online-sessions`; consultar propriedade sob RLS, exigir conta Professional Active, emitir capacidades independentes de 256 bits para cada participante e validade de duas horas.
- [ ] WebSocket `/online-sessions/{roomId}/signal` autentica a capacidade no primeiro frame, limitado e com timeout; token não vai à URL, logs ou SDP. Papel vem da sala. Recusar duplicação de participante, capacidade desconhecida/expirada e conta profissional revogada.
- [ ] Encaminhar somente SDP/ICE entre esses dois participantes; limite de mensagem, texto JSON conhecido, rejeição de binário. Encerramento cancela ambos e invalida a sala. Desconexão libera o lugar para reconexão com a mesma capacidade vigente.
- [ ] Configuração explícita de ICE/TURN; sem fornecedor externo implícito. Validar origens WebSocket pelo mesmo conjunto de origens autorizado ao app.
- [ ] Provar propriedade, expiração, papel fixo, isolamento entre salas, protocolo rejeitado e encerramento em testes de API/WebSocket reais.

## 2. Chamada na interface

- [ ] `entities/online-session` implementa contratos HTTP; `features/online-call` implementa o ciclo de RTCPeerConnection e sinalização. Convite entregue em fragmento para não enviar sua capacidade ao servidor ao abrir a página.
- [ ] Widget profissional gera link somente a partir do prontuário selecionado; paciente abre `/session/online`, consente e concede permissão antes de capturar. Exibir espera, conectado, mudo, interrupção, reconectar e encerrado; captura tardia após sair é parada.
- [ ] Fechar página/chamada, revogar consentimento ou perder definitivamente a conexão para todas as trilhas, AudioContexts, sockets e PeerConnections. Elemento audio reproduz só a trilha remota; nenhum MediaRecorder/storage no transporte online.
- [ ] Layout usa tokens editoriais existentes, botão de entrar/encerrar, consentimento e estados acessíveis. Não solicitar nome, contato ou cadastro do paciente para a chamada.

## 3. Transcrição durante a chamada

- [x] `features/live-session` aceita os dois MediaStreams autorizados; usa as trilhas originais sem tomar posse delas, conservando o mute do WebRTC, e transforma locutores em `online-profissional`/`online-paciente`. Cada origem conserva seus tempos, palavra e papel; união ordenada alimenta a transcrição e o LiveInsights.
- [ ] Integrar ao SessionReview existente, preservar revisão e salvamento de cifra no mesmo prontuário. Encerrar captura transcreve os últimos frames antes de parar a chamada; não gravar arquivo de áudio.
- [ ] Provar duas páginas reais com áudio sintético distinto nos dois sentidos, papéis exatos, texto durante a chamada, recuperação do histórico cifrado, recusa de permissão, mute, desconexão/reconexão e encerramento. Provar ausência de upload/retensão de áudio. Precisão humana e qualificação do juiz são provas separadas.

Fontes: [WebSockets ASP.NET 10](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/websockets?view=aspnetcore-10.0), [WebRTC W3C](https://www.w3.org/TR/webrtc/), [transporte DTLS-SRTP](https://www.rfc-editor.org/rfc/rfc8835.html).

Uma chamada entre páginas locais não certifica conectividade entre redes NAT diferentes. A prova em rede externa depende do TURN acessível da implantação; não declarar esse critério aprovado por usar duas páginas no mesmo host.

## Evidência local de 4 de outubro

- Dois navegadores Chromium reais, vozes sintéticas distintas, WebRTC/DTLS e Nemotron nativos: nova aprovação em 14,8 s (`.local/online-v1-e2e-atual.log`). Áudio recebido nos dois sentidos, papéis durante a captura, mute, encerramento, transcrição cifrada salva; nenhum MediaRecorder ou POST de áudio. Paciente sem identidade solicitada, 375 px sem overflow, axe sem violações.
- API completa após acervo e agenda: 883 testes, cobertura de linhas, ramos e métodos de 100% (`.local/agenda-api-completo.log`). Capacidade limitada, autorização/propriedade, isolamento entre salas, expiração, replay de participante, frames inválidos/binários, reconexão e encerramento sob falha de rede.
- App completo após acervo e agenda: 1.235 testes em 130 arquivos e 100% nas quatro métricas (`.local/agenda-app-completo.log`). Build TypeScript/Vite, arquitetura, lint e quatro catálogos com compilação estrita aprovados. A última revisão de literais internos passou nos 28 testes focados de chamada, página e agenda (`.local/agenda-online-focus-final.log`).
- Pendentes: prova do histórico em novo navegador, reconexão e permissão recusada na interface, TURN externo/HTTPS e qualificação do juiz. O resultado da chamada sintética não substitui essas provas.

O usuário reiterou em 4 de outubro a prioridade de concluir o juiz clínico. Prosseguir com sua correção e qualificação independente, sem retirar os critérios ou ativar como qualificado um modelo reprovado.
