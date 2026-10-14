# pages/pacientes

A rota `/pacientes` é a carteira do profissional: busca de pacientes por nome e
"Adicionar paciente". `PacientesPage` só nomeia a página e monta o `PatientList`
(`widgets/patient-care`), cujas pastas são links para `/pacientes/:patientId`
(`pages/prontuario`). O router exige sessão profissional com token e KEK
desbloqueados; a carteira decifra os resumos no cliente, com a KEK.

O caminho de volta das pastas e das sessões começa em "Pacientes": é daqui que se
chega a qualquer paciente.
