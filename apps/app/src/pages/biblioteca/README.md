# Biblioteca de notas

`/biblioteca` exige uma sessão profissional com token e KEK desbloqueada. A Home
oferece o link de entrada. `BibliotecaAccountPage` carrega os pacientes e seus
prontuários cifrados, decifra somente no navegador e usa `abrirNotas` para conferir
a última revisão e a assinatura de cada nota antes de exibi-la.

O carregamento identifica a conta e a chave em uso. Troca de conta ou chave,
saída da página e respostas atrasadas não podem publicar a biblioteca anterior.
Falha na API, cifra, assinatura ou OPFS aparece como erro com nova tentativa.

`BibliotecaPage` compõe agrupamento, MiniSearch e persistência local. O widget
mostra nome do paciente, texto SOAP, revisão e estado assinado/rascunho. Rascunhos
ficam antes das assinadas. A busca usa somente o índice em memória; seu termo não
é enviado à API nem ao copiloto.

O arquivo `<raiz OPFS>/<accountId>/indice-busca` contém um índice cifrado com
DEK nova, embrulhada pela KEK da conta. As duas AAD vinculam a cifra à conta.
A impressão `id:revisao` impede restaurar um índice de notas antigas. A saída
apaga a árvore OPFS da conta por `purgarOpfsDaConta`.

Áudio de sessão não faz parte da biblioteca ou da persistência. A verificação
local incluiu nota realmente assinada, busca sem envio do termo, índice sem
texto em claro, purga ao sair e acessibilidade em desktop e celular.
