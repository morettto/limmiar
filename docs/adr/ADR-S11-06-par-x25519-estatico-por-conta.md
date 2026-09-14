# ADR-S11-06: Par X25519 estático por conta, privada selada no servidor

## Contexto

O S11-02 vai cifrar itens que a paciente partilha com a chave pública X25519 da profissional
(primitivas do S01-03). Para isso funcionar em mais de uma sessão, a pública tem de ser estável:
a profissional pode abrir a app num segundo dispositivo, e a paciente pode recuperar a conta pela
frase BIP39. Nos dois casos, quem decifra depois precisa da mesma privada que cifrou antes -- uma
pública que muda a cada dispositivo tornaria ilegível tudo o que já foi cifrado para a antiga.

Três alternativas para onde a privada vive (`.harness/abordagem/S11-04.md`, decisão b):

- **Só local** (localStorage/IndexedDB, cifrada pela KEK): zero rota de envelope, mas cada
  dispositivo novo gera o seu próprio par. A pública muda, e os itens cifrados para a antiga ficam
  ilegíveis para a profissional a partir desse dispositivo.
- **Derivar a privada da semente BIP39** (HKDF → X25519), sem guardar nada: zero armazenamento,
  mas acopla a chave de partilha à frase de recuperação, que não está disponível no desbloqueio
  normal por password. Rotação da chave de partilha fica impossível sem trocar de frase.
- **Envelope no servidor**: `publicKey` em claro, `wrappedDek` e `sealedPrivateKey` cifrados pela
  KEK da conta -- o mesmo molde do `VoiceEnrollment` (S05).

Só a terceira dá estabilidade multi-dispositivo sem acoplar a cripto de partilha à frase de
recuperação. O custo é material de chave privada, ainda que selado, a viver no servidor -- uma
superfície que o resto do produto zero-knowledge evita.

## Decisão

Cada conta tem no máximo um par X25519. `Account.KeyPair` guarda `AccountKeyPair(PublicKey,
WrappedDek, SealedPrivateKey)`: a pública em claro (32 bytes), e a privada cifrada por uma DEK
nova, que por sua vez está embrulhada pela KEK da conta (`generateWrappedDek` + `encrypt`, as
mesmas primitivas do `VoiceEnrollment`). O servidor nunca vê a privada em claro.

O par nasce no primeiro desbloqueio do chaveiro em que um ecrã de vínculo precisa dele
(`garantirParDeChaves`, `entities/vinculo/par-de-chaves.ts`): `GET /accounts/{id}/key-pair`; um
404 gera o par, sela a privada e publica com `PUT`. Um 200 decifra o envelope existente em vez de
gerar outro -- é assim que o segundo dispositivo, ou a mesma pessoa depois de recuperar a conta,
converge para o mesmo par em vez de substituí-lo.

A pública é **imutável depois de publicada**: `AccountKeyPairService.PublishAsync` aceita
republicar o mesmo envelope com a mesma `publicKey` (serve a rotação da KEK via `rewrapDek`, sem
tocar na chave de partilha), e devolve 409 se a `publicKey` for outra. A primeira publicação
vence; dois dispositivos em corrida no primeiro desbloqueio convergem para o par de quem chegou
primeiro, porque o segundo perde o `PUT` com 409 e lê de volta o que já está publicado.

A única resposta da API que devolve a pública de **outra** conta é `GET /accounts/{id}/links`
(decisão d do mesmo portão de abordagem): a pública chega embutida em `LinkView.PeerPublicKey`, e
só a quem já é parte do vínculo. Não há rota de chave pública por id de conta.

## Consequências

- A paciente confia no servidor para lhe devolver a pública certa da profissional (e
  vice-versa): não há verificação de fingerprint fora de banda neste ticket. Se um verificador de
  fingerprint entrar mais tarde, é aditivo -- não muda o formato do envelope nem a imutabilidade
  da pública.
- Quem compromete a KEK de uma conta ganha a privada de partilha dessa conta, além de tudo o resto
  que a KEK já protege (`VoiceEnrollment`, blobs clínicos). Este ADR não alarga o raio de
  compromisso da KEK; usa o raio que já existe.
- A pública nunca muda depois da primeira publicação. Isto é uma porta de sentido único: reverter
  para "um par por dispositivo" depois de o S11-02 já ter cifrado itens para a pública estável
  exigiria re-cifrar tudo o que a profissional ainda não decifrou, ou aceitar perda de acesso.
- Forward secrecy e rotação periódica do par ficam fora de âmbito. Se um dia forem exigidas, o
  par deixa de ser estático e passa a precisar de versão -- outro ADR, porque recifra o que já foi
  partilhado.
- Sem Postgres na suite E2E (`playwright.config.ts`), o par vive em `Account` em memória, com o
  mesmo teto de durabilidade das contas: reinício perde tudo. Não é decisão deste ADR -- é herdado
  de `InMemoryAccountStore`, e persistir contas é um ticket à parte.
