# Chave pessoal dos prontuários

O login autentica a conta. Para um profissional, acessar pacientes, notas, voz e acervo exige também desbloquear o cofre clínico. A senha de login, Google, segundo fator e frase de recuperação do login não derivam nem recuperam a chave clínica.

No primeiro acesso, o navegador gera a chave pessoal e três códigos de recuperação. A tela mostra os segredos somente nessa etapa, oferece cópia/download explícitos e exige confirmar a guarda antes de publicar o cofre. Não existe endpoint, botão ou armazenamento local para revelar a chave posteriormente. Abrir outra aba, recarregar, sair ou usar **Bloquear prontuários** exige a chave novamente. O pareamento antigo de dispositivos foi retirado das rotas do profissional.

**Perda:** o profissional entra na conta, escolhe **Perdi minha chave pessoal** e informa um código de recuperação. O navegador recupera a mestra, gera nova chave pessoal e novos códigos e exige guardá-los antes de confirmar. A atualização atômica substitui todos os envelopes anteriores. Sem a chave e sem um código válido, os dados permanecem inacessíveis; o suporte não tem segredo para recuperá-los. Códigos de backup TOTP e passkeys WebAuthn não substituem os códigos do cofre.

## Modelo criptográfico

- Mestra, chave pessoal e cada código: 32 bytes independentes de CSPRNG, 256 bits.
- Os segredos são tokens versionados; códigos incluem um UUID público que identifica seu envelope. O UUID não é um segredo nem conta como entropia do código.
- HKDF-SHA256 deriva chaves de envelopamento e um verificador separado. Salt vincula a conta; `info` separa `unlock`, `recovery|slotId` e `verifier|slotId`.
- AES-256-GCM protege cada cópia da mestra. Nonce aleatório interno, 12 bytes; tag de 16 bytes; envelope de 60 bytes. AAD vincula protocolo, conta, revisão e slot.
- O servidor guarda envelopes e SHA256 do verificador derivado. GET não retorna verificadores nem seus hashes. Nenhuma chave pessoal, código ou mestra em claro viaja nas requisições.
- Criação não sobrescreve cofre existente. Recuperação requer bearer da conta, verificador do código e revisão atual. Comparação em tempo constante e `UPDATE ... WHERE revision = ...` impedem duas recuperações concorrentes.
- PostgreSQL usa RLS por conta, como os demais dados clínicos. O GET do cofre é `no-store`.
- A mestra ativa é um `CryptoKey` não extraível, com operações restritas a envelopar/desenvelopar DEKs. Dados já existentes continuam usando os seus DEKs e AADs, sem nova implementação de cifra de prontuários.
- Recuperar preserva a mestra: não exige regravar pacientes, notas, voz, materiais ou partilhas.

## Memória e limites

Não há persistência de segredos no navegador. Buffers temporários controlados pelo código são zerados. Strings JavaScript, memória do navegador, swap e handles Web Crypto não permitem promessa de apagamento físico imediato. Copiar ou baixar o kit é uma exportação explícita para o local escolhido pelo usuário; o aplicativo não pode apagar cópias externas ou histórico de clipboard.

Trocar a chave de acesso invalida os envelopes correntes. Não revoga uma sessão que já possua a mestra nem cópias antigas de envelopes exfiltrados. Recuperação por perda não substitui um procedimento de resposta a comprometimento. Backend malicioso pode negar serviço ou servir JavaScript adulterado; criptografia no navegador não protege contra o próprio cliente comprometido.

## Base local e validação

As cifras antigas derivadas da senha não são suportadas. A criação do cofre recusa uma conta que ainda tenha registros clínicos, materiais, perfil de voz ou par de chaves anterior. Não há migração silenciosa nem substituição desses dados por uma chave aleatória.

O reset solicitado fica restrito ao contêiner `limmiar-local-postgres`, volume de mesmo nome, porta local `127.0.0.1:5432` e database `limmiar_local`. Execute `node tools/reset-local-database.mjs`; depois `pnpm dev` recria o esquema. O script valida identidade do alvo antes de apagar o esquema público. Não toca no acervo científico SQLite. Limpe também os dados do site no navegador utilizado para retirar caches cifrados e sessões antigas.

Nesta execução, o Docker respondeu após a tentativa inicial. A base local foi zerada e o esquema recriado: 0 contas, 0 entradas de prontuário e 0 cofres. Foram removidas 27 contas e 67 entradas antigas. O acervo científico foi preservado. Passaram 96 testes da API, incluindo PostgreSQL real, RLS, concorrência e recuperação. Testes de criptografia, interface, contratos HTTP e autenticação do app passaram. A prova de Chromium com persistência HTTP simulada usa criptografia e prontuário cifrado reais; capturas desktop/mobile e Axe estão em `.local/vault-browser`. A prova integrada de navegador usa uma base E2E separada, sem repovoar `limmiar_local`.

Referências: [Cryptomator Hub](https://docs.cryptomator.org/security/hub/), [Cryptomator cryptolib](https://github.com/cryptomator/cryptolib/blob/develop/src/main/java/org/cryptomator/cryptolib/common/MasterkeyFileAccess.java), [Bitwarden](https://bitwarden.com/help/security-faqs/). O desenho usa a mesma separação entre login, chaves mestras e envelopes; não copia protocolos ou promessas de auditoria desses projetos.

A prova integrada final passou em quatro cenários com API e PostgreSQL reais: cadastro/saída, recuperação da autenticação mantendo o cofre bloqueado, recuperação clínica preservando paciente e rejeição de códigos antigos. O cenário de recuperação de login também reabre uma nota assinada com a chave pessoal. As fixtures foram atualizadas para guardar os segredos somente na memória do teste.
