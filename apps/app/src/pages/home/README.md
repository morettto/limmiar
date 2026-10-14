# pages/home

A Home da rota `/` recebe conta, token e KEK desbloqueados pelo router. Ela
carrega a verificação profissional pela API real. Conta pendente permite enviar
a referência documental e acompanhar a revisão; conta ativa vê o painel do dia
("Seu dia": os encontros de hoje e o que requer o profissional).

A carteira de pacientes saiu da Home: cadastro e busca vivem em `/pacientes`
(`pages/pacientes`), e cada pasta (`pages/prontuario`) guarda o prontuário cifrado,
a agenda e as sessões. A Home não mantém estado de paciente nem de gravação:
nada nela precisa travar a navegação.

A navegação (destinos, configurações da conta e "Sair") não é da Home: vive na barra do
consultório, `widgets/app-shell`, montada na raiz do router. `terminarSessao` remove
imediatamente chaves e dados locais e revoga a família de tokens na API; falha de rede mostra
uma ação para repetir a revogação.

A Home usa o design editorial compartilhado do app: fundo de papel, tipografia
serifada e primitivas e tokens de `packages/ui`. Ela compõe os módulos e não
implementa cifra, transcrição ou classificação bibliográfica.

O `PainelProfissional` mostra agenda, consentimentos, avaliação de risco e notas
reais. `carregarBiblioteca` recupera as notas cifradas e confere assinaturas;
falha de leitura tem mensagem e nova tentativa. "Iniciar próxima" e os encontros
levam à pasta do paciente com `?agendamento=<id>` (destaque e foco em "Iniciar sessão");
uma pendência de assinatura leva direto à aba da nota da sessão
(`/pacientes/:id/sessoes/:atendimentoId?aba=nota`). Cadastro de paciente atualiza o painel.
