# pages/atendimento

A rota `/pacientes/:patientId/sessoes/:atendimentoId?aba=insights|nota` é a
sessão clínica ("atendimento" no código, "Sessão" na tela). Ela herda o layout
de `/pacientes/:patientId` (guarda profissional e `ProntuarioProvider`) e lê o
prontuário com `useProntuario()`; um `atendimentoId` que não está na pasta mostra
um aviso com o caminho de volta.

`AtendimentoPage` tem duas abas, escolhidas por `?aba=` (padrão `insights`), que
são links com `aria-current`. Os dois painéis ficam montados e o inativo recebe
`hidden`: a gravação e a nota em edição sobrevivem à troca de aba.

- **Insights**: consentimentos do paciente (sempre à vista, para revogar durante a
  gravação), tipo de sessão (presencial ou online, escolhido aqui e não gravado) e
  `SessionReview`/`OnlineSession`. Uma gravação por sessão: com transcrição salva
  a sessão abre com a última revisão e sem escolha de modalidade; correções são
  novas revisões da mesma transcrição.
- **Nota**: `NotaDoAtendimento` (`features/nota-editor`), uma nota por sessão.
  "Usar na nota" num insight guarda a referência proposta na página e leva à aba
  da nota; "Ver fala da referência" volta à aba dos insights.

`pendente` (gravação em curso ou transcrição sem salvar, informada por
`onPendingChange`) é o único estado que trava a saída: `useBlocker` pede
confirmação quando o caminho muda e não quando só `?aba=` muda. Enquanto
`pendente`, `useBloquearNavegacao` (`widgets/app-shell`) também desabilita os links e o "Sair" da
barra do consultório; o `useBlocker` fica para o que a barra não cobre (migalhas, botão voltar). Recarregar a
página no meio da gravação perde o áudio de propósito (só existe em memória) e a
sessão volta ao estado anterior à gravação. Depois de salvar transcrição ou nota
a página relê o prontuário; se a releitura falha, avisa.

Atalhos de entrada: o painel do dia leva "Assinar nota pendente" direto à aba da
nota da sessão (`?aba=nota`).
