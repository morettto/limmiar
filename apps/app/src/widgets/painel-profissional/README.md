# widgets/painel-profissional

Painel inicial da Home profissional: próxima sessão nomeada, pacientes ativos,
sessões da semana, encontros de hoje e dos próximos dias, e fila Requer você.
Nomes são decifrados no cliente; requisições usam apenas IDs opacos da carteira.

## Fontes e ações

A Home monta o painel após verificação ativa, com conta, token e KEK reais.
O painel carrega agenda, sumários cifrados e consentimentos. A Home fornece notas
recuperadas pelo mesmo carregarBiblioteca usado pela biblioteca, que verifica
revisões e assinaturas. Falha de leitura aparece com ação para repetir; não
representa uma fila de assinaturas vazia validada.

onStart(patientId, agendamentoId) abre a pasta do paciente com o agendamento
destacado; é lá que a sessão começa. Captura exige a ação explícita do
profissional e os consentimentos existentes. Abertura de pasta não solicita
microfone nem inicia reconhecimento. onOpenItem(patientId, atendimentoId?) abre a
nota da sessão quando a pendência é uma assinatura (a pendência carrega o
atendimentoId da nota) e a pasta do paciente nos demais casos.
Sem sumário decifrado, a agenda não habilita abertura de paciente desconhecido.

O painel não trava nada: gravação e transcrição pendentes vivem na página da
sessão. versao recarrega fontes após cadastro, consentimento, nota ou mudança de agenda.
Notas atualizadas são entregues pela prop; não há cópia persistida no painel.

## Isolamento e ciclo de vida

- Chaveiro null bloqueia nomes e pedidos diretamente no render.
- Agenda e pacientes têm resultados independentes: a falha de uma fonte não
  derruba a outra. Códigos são traduzidos no render; trocar idioma não repete leitura.
- O efeito depende de conta, KEK, origem, decifrador e versão. Token renovado é
  lido por ref antes de cada pedido; renovação não exige nova decifragem.
- Cleanup aborta o worker, descarta respostas anteriores e limpa o estado. Os
  endpoints de leitura ainda não recebem AbortSignal: respostas de rede em voo
  terminam e são descartadas, sem atravessar a troca de conta.
- Consentimentos são recuperados por paciente. Falha individual não é tratada
  como concessão e não fabrica uma pendência confirmada.
- O painel não classifica risco clínico. Usa a avaliação registrada pelo
  profissional no sumário cifrado e as pendências efetivas do prontuário.

## Verificação

Testes cobrem falhas parciais, tradução, renovação de token, troca de conta,
respostas tardias, isolamento da nota e bloqueio durante captura. A prova real
em .local/painel-v1-prova.json confirmou pasta e nota corretas, atualização após
assinatura, consentimento e cancelamento, zero identidade ou conteúdo clínico
em claro nas mutações, zero pedidos de microfone ao abrir pasta e acessibilidade
em desktop e 375 px. Notas sintéticas são cifradas de verdade; a prova não usa
hooks de produção ou KEK na URL.
