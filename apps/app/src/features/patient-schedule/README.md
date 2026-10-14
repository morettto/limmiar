# Agenda do prontuário

`PatientSchedule` cria, remarca e cancela horários reais pela API autenticada.
Mostra sete dias a partir da data escolhida, no fuso do navegador, e apenas
sessões do prontuário selecionado. Não envia nome nem conteúdo clínico.

`pages/prontuario` monta o componente por conta e paciente. Um agendamento que
já tem sessão (`iniciadas`, os `agendamentoId` dos atendimentos do prontuário)
mostra "Sessão iniciada" no lugar de remarcar e cancelar: a sessão aponta para o
agendamento e ele não pode sumir ou mudar de hora por baixo dela. Respostas antigas de listagem são descartadas
ao trocar a janela ou desmontar. Conflitos de horário e ausência de prontuário
próprio são decididos atomicamente pelo PostgreSQL; falhas mantêm o formulário.
