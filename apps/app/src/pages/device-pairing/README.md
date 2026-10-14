# Pareamento de dispositivos

Rotas de produção `/devices/pair-primary` e `/devices/pair-new`, protegidas pela sessão profissional. Origem exige KEK desbloqueada; destino autentica a conta antes de receber a chave. Nenhum parâmetro de URL fornece servidor, credencial ou chave.

O QR contém somente sessão transitória, chave pública X25519 e origem da API. O destino confere a origem e a chave do QR antes de aceitar a resposta. Ambos derivam um código de confirmação de 64 bits a partir do segredo do canal e da sessão; a origem só transmite após comparação explícita. O servidor recebe AES-GCM com AAD da sessão. Alterar uma chave muda o código ou impede decifrar.

A senha reconstrói a KEK somente ao confirmar a transferência e é conferida contra a KEK não extraível já desbloqueada. Cópias de bytes são zeradas. O destino importa uma KEK não extraível na sessão em RAM, sem persistir chave ou texto clínico. Erro, expiração e saída encerram a transferência. A câmera abre após ação explícita, mostra preview e para inclusive se a permissão chegar após a saída.

Provas unitárias: rejeição de origem/chave substituída, segredo inválido, comparação obrigatória, recusa de senha diferente, zeroização e limpeza da câmera. A prova em navegador deve recuperar o mesmo prontuário cifrado em outro contexto, com desktop/celular acessíveis.
