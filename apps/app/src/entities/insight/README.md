# Insights bibliográficos durante a sessão

`falas-paciente.ts` seleciona palavras antes da fronteira estável de diarização,
somente de vozes identificadas explicitamente como paciente. Voz desconhecida
ou profissional interrompe o trecho; as cinco frases anteriores do paciente
formam o contexto. Pontuação final, troca de voz ou uma pausa de 900 ms entre
palavras fecham a frase, e a última frase final fecha na hora, com ou sem pontuação:
o servidor só entrega uma frase final depois de fechá-la pelo silêncio. Uma palavra
além da fronteira estável deixa a frase em curso para a próxima leitura. Cada consulta
leva `fimMs`, o fim da última palavra, que não vai ao servidor.

`turnos-paciente.ts` faz uma passada sobre a fala inteira do paciente, só depois da
gravação, quando ela termina por voz do profissional ou 2,5 s de silêncio estável (na
prática, a fronteira máxima do fim da gravação), e só quando junta duas ou mais frases.
O tracejado liga-se às frases da fala.

`fila-insights.ts` executa uma consulta por vez, sem espera. `atualizar(consultas, relogio)`
recebe o relógio de conversa (`estavelAteMs`) durante a gravação: vai a frase pendente mais
nova com até 15 s (`relogio - fimMs`), e as mais velhas ficam guardadas. Sem relógio (gravação
encerrada), as pendentes seguem na ordem de chegada. Frase nova não cancela a consulta em
curso; mudanças de texto, papel ou contexto invalidam o resultado e cancelam a consulta
daquela frase. Encerrar o componente cancela o trabalho pendente.

A fila distingue três falhas (`falha-insight.ts`, `FalhaInsight`) e avisa o chamador com
`falhar(falha, consulta)`. `fora` (rede, prazo, 401 ou HTTP 5xx diferente de 503) devolve a mesma
consulta ao fim da fila, e a próxima tentativa espera uma fração aleatória de um teto de 1 s, 2 s,
4 s... até 30 s; qualquer resposta do serviço zera o teto. Uma fala nova durante a espera não a
fura, e ao vivo a consulta devolvida envelhece como qualquer outra. `nao_liberado` (503) e
`sem_analise` (resposta inválida, outro 4xx ou erro no stream) encerram só aquela consulta, sem
nova tentativa: a primeira é um aviso do serviço inteiro, a segunda vale só para a fala.

`insight.ts` envia somente texto do paciente e contexto ao serviço local. Não
envia identidade, chave ou áudio. O `idioma` da consulta é o locale ativo do app
(`i18n.locale`); o servidor precisa aceitar os quatro locales do app. A rota `/api/consultar-qualificado` exige o gate
independente de qualidade; indisponibilidade aparece na interface. Todas as
fontes retornadas são preservadas e seus campos de citação são validados, inclusive
`probabilidade` (número de 0 a 1) e `nivel` (`"forte"` ou `"possivel"`, decidido pelo
servidor). A resposta traz sempre `juiz`, a versão do juiz; sem ela a resposta é inválida.
Uma requisição que passa de 30 s (acima do máximo de 23,6 s medido na carga) é abortada e
conta como `fora`, assim como o 401 do token vencido. 503 vira `nao_liberado`; aborto do
chamador segue como aborto. A resposta NDJSON tem uma linha só, com `completo: true`: o
servidor decide numa passada (`mvp-copiloto/src/copiloto/decisao.py`). Outra linha depois
dela torna a resposta inválida.

`voto-store.ts` guarda, em `localStorage`, os votos "útil / não útil" dos
cartões como eventos do contrato de `docs/juiz-ciclo-de-treino.md` seção 1. Um
envelope AES-GCM por conta cifra todos os votos (mesmo padrão de
`entities/checkin`); `usuario` é o SHA-256 do id da conta, nunca o e-mail. Novo
voto na mesma fala e trecho substitui o anterior. `juiz` vem do campo `juiz` da resposta,
sempre presente. Cada voto guarda também `enviado`,
só local, que nunca entra no corpo enviado; leituras e regravações passam por
uma fila para voto e marca de envio simultâneos não se perderem.

`consentimento-voto.ts` guarda por conta, em `localStorage`, `"sim"` ou `"nao"`
(ausente = ainda não perguntado). O voto é sempre gravado; só com `"sim"` ele
nasce com `consentiu: true`. Mudar a escolha não reescreve votos antigos.

`voto-envio.ts` (`enviarPendentes`) manda a `POST /copiloto/api/votos?accountId=<conta>`, com o mesmo
bearer das consultas (`enviarVoto` em `insight.ts`), os votos com `consentiu` e
sem `enviado`, no máximo 20 por vez. 204 e 400 marcam enviado (400 não melhora
reenviando); rede, 401 ou 5xx param o lote e o voto fica pendente até o próximo
voto ou a abertura da sessão. Sem consentimento `"sim"` ou sem credencial do
acervo, nada sai. O corpo traz só os campos do contrato.
