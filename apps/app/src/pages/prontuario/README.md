# pages/prontuario

A rota `/pacientes/:patientId` é a pasta do paciente. O layout do router exige
sessão profissional com token e KEK desbloqueados (fora do layout `paciente`,
que é só do papel Patient) e abre o prontuário uma vez por paciente com
`ProntuarioProvider` (`features/prontuario`); a página lê o resultado com
`useProntuario()` e recebe só as credenciais e o `patientId` por props.
`?agendamento=<id>` vem do painel do dia e destaca esse agendamento.

`ProntuarioPage` compõe, de cima para baixo: caminho de volta
(`<nav aria-label>`), `HojeDoPaciente` (agendamentos de hoje com "Iniciar
sessão" ou "Abrir sessão", e "Iniciar sessão agora"), `PatientSessions` (as
sessões já iniciadas, com o estado da transcrição e da nota), `PatientSchedule`
(a agenda dos próximos 7 dias) e `PatientAccess` (acesso e consentimentos,
recolhido). O `<h1>` é o nome do paciente e recebe o foco quando a pasta abre;
com `?agendamento=` o foco vai para o botão do agendamento destacado.

A pasta não grava nem transcreve: gravação, insights e nota vivem na página da
sessão (`pages/atendimento`), que é o que trava a navegação. Agendar, remarcar
ou cancelar relê "Hoje".

`ProntuarioPage.test.tsx` cobre a composição e o foco; `router.test.tsx` cobre a
guarda, o provedor e as props.
