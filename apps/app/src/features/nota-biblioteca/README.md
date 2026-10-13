# Biblioteca de notas e busca local

`carregar-biblioteca.ts` recebe conta, token e KEK. Carrega os pacientes da conta,
decifra nomes e prontuários no cliente e recupera as notas com `abrirNotas`.
Somente a última revisão de cada nota entra na biblioteca; assinaturas são
verificadas com a DEK do paciente. Falha de autenticação, cifra ou assinatura
rejeita o carregamento, em vez de aparentar uma biblioteca vazia.

`biblioteca.ts` agrupa notas por paciente, preservando a ordem dos grupos e
colocando rascunhos antes das assinadas. `indice.ts` usa MiniSearch já instalado:
indexa texto das frases, busca localmente e distingue preparação, busca ociosa
e resultado pronto. Um resultado pronto vazio significa ausência de notas
correspondentes. O termo pesquisado nunca sai pela rede.

O índice serializado contém a impressão ordenada `id:revisao`. Restaurar um
índice com impressão diferente o descarta e reconstrói com as notas atuais.
`OPCOES_INDICE` é compartilhada pela construção e restauração, para os campos
não divergirem.

`indice-crypto.ts` exige uma KEK com usages `wrapKey`/`unwrapKey`, marcada por
`chaveIndiceDaConta`. Cada gravação gera uma DEK fresca. O formato é DEK
embrulhada de 60 bytes seguida do conteúdo cifrado, com AAD próprias vinculadas
ao `accountId` para embrulho e conteúdo. Nenhum JSON do índice chega ao disco
em claro.

`indice-store.ts` lê e grava o blob cifrado em `indice-busca`, dentro do
diretório OPFS da conta fornecido pelo chamador. Arquivo ausente retorna `null`;
outros erros propagam. A purga ao sair apaga a árvore da conta pelo módulo
`entities/account/opfs-conta.ts`. OPFS aqui armazena somente o índice de texto;
não existe armazenamento de áudio de sessão.

Decisões: ADR-S08-10 (chave de conta para busca), ADR-S18-01 (purga da árvore) e
ADR-0010 (atualização isolada de MiniSearch com leitura de changelog).
