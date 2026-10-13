# Insights bibliográficos durante a sessão

`falas-paciente.ts` seleciona palavras antes da fronteira estável de diarização,
somente de vozes identificadas explicitamente como paciente. Voz desconhecida
ou profissional interrompe o trecho; as cinco frases anteriores do paciente
formam o contexto. Pontuação final, troca de voz ou uma pausa de 900 ms depois
da fronteira estável fecham a frase. O texto ainda incompleto espera esse limite,
para cada nova palavra não cancelar a análise da frase já concluída.

`turnos-paciente.ts` faz uma passada final sobre a fala inteira do paciente,
quando ela termina por voz do profissional ou 2,5 s de silêncio estável, e só
quando junta duas ou mais frases. O tracejado liga-se às frases da fala; fontes
já mostradas para uma dessas frases não se repetem no balão da fala inteira.

`fila-insights.ts` executa um lote por vez, na ordem das frases pendentes.
Cada continuação volta ao fim da fila: novas frases e fontes restantes recebem
sua vez mesmo sob chegada contínua. Um cursor assinado
retoma a posição, sem julgar novamente as fontes anteriores. Mudanças de texto,
papel ou contexto invalidam resultados e o cursor. Encerrar o componente cancela
o trabalho pendente e apaga o progresso em memória.

A fila distingue três falhas (`falha-insight.ts`, `FalhaInsight`) e avisa o chamador com
`falhar(falha, consulta)`. `fora` (rede, prazo ou HTTP 5xx diferente de 503) devolve a mesma
consulta ao fim da fila, com o cursor em que parou, e a próxima tentativa espera 1 s, 2 s, 4 s...
até 30 s; qualquer resposta do serviço zera a espera. Uma fala nova durante a espera não a
fura. `nao_liberado` (503) e `sem_analise` (resposta inválida, 4xx ou erro no stream) encerram
só aquela consulta, sem nova tentativa: a primeira é um aviso do serviço inteiro, a segunda
vale só para a fala.

`insight.ts` envia somente texto do paciente e contexto ao serviço local. Não
envia identidade, chave ou áudio. O `idioma` da consulta é o locale ativo do app
(`i18n.locale`); o servidor precisa aceitar os quatro locales do app. A rota `/api/consultar-qualificado` exige o gate
independente de qualidade; indisponibilidade aparece na interface. Todas as
fontes retornadas são preservadas e seus campos de citação são validados, inclusive
`probabilidade` (número de 0 a 1) e `nivel` (`"forte"` ou `"possivel"`, decidido pelo
servidor). A resposta traz sempre `juiz`, a versão do juiz; sem ela a resposta é inválida.
Uma requisição que passa de 60 s (teto folgado, não medido) é abortada e conta como `fora`.
503 vira `nao_liberado`; aborto do chamador segue como aborto.
Cada resposta NDJSON traz um lote e informa conclusão ou continuação. O cursor
contém somente posição e assinatura, vinculadas à consulta, obras, versão e
limiares; não contém fala ou contexto. Reiniciar o serviço invalida os cursores.
O cliente reúne todas as fontes dos lotes e deduplica apenas a mesma passagem.
Falha na continuação retira o resultado inteiro dessa fala. Assim as fontes
aparecem durante a sessão e uma frase longa não monopoliza a fila até varrer
todo o acervo.

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
