# Perfil de voz cifrado

`modelo` fixa o SHA-256 e valida as 192 dimensões do TitaNet Large. `extrator`
abre um único worker WebAssembly por uso, valida o handshake e suas saídas,
limita o tempo de preparação/inferência e encerra recursos no cancelamento.
O worker recebe uma cópia transferida do PCM; nenhuma gravação vira arquivo.

`voice-crypto` usa DEK própria envelopada pela KEK e AAD diferente por contexto,
modelo e conta. O plaintext tem exatamente 768 bytes float32 little-endian;
o perfil selado tem 796 bytes. Descriptografia valida o conteúdo e apaga o buffer.
Perfis de outro modelo ou conta não são aceitos.

`voice-enrollment` envia somente `wrappedDek` e `sealedEmbedding` em base64.
GET exige 200 e envelopes com tamanho correto; cadastro/remoção exigem 204.
Vetores abertos não entram em armazenamento, telemetria nem corpo HTTP.
