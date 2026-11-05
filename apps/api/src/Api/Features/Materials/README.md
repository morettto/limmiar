# Materiais criptografados e uso em atendimento

A API guarda apenas conteúdo e metadados cifrados. Autorizar um material e reservar
uma seleção não vazia exige que o serviço bibliográfico confirme `ready: true` em
`GET /api/acervo/{accountId}` para todos os IDs. A API encaminha o Bearer da conta;
não aceita um indicador de preparo fornecido pelo navegador. Revogar autorização,
liberar reservas e excluir materiais não consultam esse serviço.

Configure `Copiloto__BaseUrl` na API com a URL interna do serviço bibliográfico
(por exemplo `http://127.0.0.1:8000` no desenvolvimento). `tools/dev.mjs` define esse
valor local; o deploy precisa fornecer a URL interna correta. A falta de URL,
resposta inválida, falha HTTP ou timeout de 5 segundos devolve 503
`materials.readiness_unavailable`; material ainda não preparado devolve 409
`materials.not_prepared`. O estado é o preparo atual no serviço, que pode precisar
ser refeito depois de reiniciá-lo. Não existe fallback que autorize automaticamente.

`PUT /accounts/{accountId}/materials/usage/{sessionId}` com `{materialIds: [...]}`
acrescenta atomicamente os IDs à reserva do atendimento, sem liberar materiais
selecionados anteriormente. Só uma lista vazia no encerramento libera todos os IDs.
A reserva persiste no PostgreSQL até liberação explícita, inclusive após fechamento
inesperado do navegador. O cliente libera ao encerrar o atendimento, nunca por
unmount. Cada lista de materiais traz `inUse`; excluir um material reservado
retorna 409 `materials.in_use`. A migração 0020 aplica RLS por conta e chave
estrangeira; os locks das linhas de material impedem corrida entre reserva e
exclusão. Não há expiração automática de reservas.


## Capturas simultâneas e encerramento

Antes de iniciar microfone, ASR de arquivo ou trilhas online, cada execução adquire
`PUT /usage/{sessionId}/captures/{captureId}` com os IDs selecionados (inclusive
lista vazia). A transação adiciona as reservas e registra a captura sob o mesmo
lock da sessão. `DELETE` nessa URL libera somente aquela captura, depois do
teardown real; as obras continuam reservadas até o encerramento do atendimento.
`PUT /usage/{sessionId}` com lista vazia rejeita 409 `materials.in_use` se ainda
existir qualquer captura ativa, inclusive de outra aba ou dispositivo.

Sem capturas ativas, essa última operação fecha duravelmente o uso de materiais
pela sessão e libera suas obras. O cliente a executa antes de anexar o encerramento
cifrado. Novas reservas/capturas dessa sessão fechada retornam 409
`materials.session_closed`: não há janela entre liberação e gravação do prontuário
em que outra aba possa retomar uma captura. Se o append cifrado falhar, o cliente
pode repetir o encerramento; a sessão não aceita nova gravação após essa tentativa.

O navegador mantém um Web Lock por captureId durante toda a captura. Marcadores
locais guardam somente IDs da conta/sessão/captura, sem Bearer, áudio ou conteúdo.
A recuperação de capturas interrompidas tenta adquirir cada lock com `ifAvailable`:
se outra aba ainda o mantém, não envia liberação alguma. Fechamento/crash da aba
solta o lock pelo navegador; outro dispositivo não vê esses marcadores locais.
Browsers sem Web Locks recusam iniciar, sem fallback inseguro. Falha ao concluir
a transcrição descarta explicitamente o transporte antes de liberar a captura;
se o descarte não concluir, captura e marcador permanecem. Falha HTTP de liberação
oferece repetição na tela, sem precisar recarregar. A liberação na
API deixa `released=true` por captureId, impedindo que uma aquisição atrasada
ressuscite a captura depois da recuperação de uma resposta de rede perdida.
