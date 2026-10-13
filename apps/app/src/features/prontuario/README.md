# features/prontuario

Abre a pasta do paciente e começa as sessões dela. Compõe só entidades
(`atendimento`, `consentimento`, `nota`, `patient`, `transcricao`, `agenda`).

- `abrirProntuario` lê e decifra o registro append-only do paciente (nome, risco, DEK,
  consentimentos, transcrições, atendimentos e notas com a assinatura conferida). Entrada
  ilegível ou de outro tipo é ignorada: cada leitor falha fechado.
- `ProntuarioProvider` abre o prontuário uma vez por paciente (a rota usa `key={patientId}`) e
  entrega `{ prontuario, recarregar }` por `useProntuario()`. `recarregar` relê sem desmontar os
  filhos, descarta a resposta de uma releitura mais velha que a última pedida e usa sempre o
  token mais recente sem reabrir a pasta; rejeita se a leitura falha.
- `iniciarAtendimento` cria o atendimento (a sessão): sem agendamento, cria um agendamento
  "agora" de 50 minutos e usa o id devolvido pela API; relê o registro e reaproveita o atendimento
  que já existe para o mesmo agendamento (outra aba, retomada), senão acrescenta a entrada
  `{ tipo: 'atendimento', ... }` cifrada.
- `HojeDoPaciente` lista os agendamentos de hoje do paciente com "Iniciar sessão" (ou "Abrir
  sessão" se já começou) e oferece "Iniciar sessão agora". `destaque` (do painel) marca e foca o
  agendamento.
- `EstadoDoAtendimento` resume uma sessão: "Transcrição salva · Nota pendente|assinada".
