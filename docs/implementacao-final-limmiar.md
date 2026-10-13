# Fecho da implementação do Limmiar

Fonte do escopo: vault `C:\Users\m0retto\Documents\obsidian\limmiar\limmiar`.
Leitura integral em 2 de outubro de 2026: 436 documentos e artefatos de documentação,
2.391.892 bytes, incluindo specs, tickets, receipts, handoffs, pesquisas e traces.
Os intervalos de leitura foram conferidos antes da consolidação. Arquivos internos
de Git e da configuração do Obsidian não fazem parte desse inventário documental.

Este registro distingue implementação presente, integração de produção e prova
de funcionamento. Um receipt verde de componente ou scaffold não fecha o fluxo
real. Os estados abaixo não alteram os tickets do vault nem aprovam decisões
humanas pendentes.

## Requisitos que prevalecem

- Concluir o produto já planejado, incluindo prontuário, agenda, acesso, paciente
  e copiloto. A instrução posterior autorizou o frontend editorial como próxima
  tarefa; sua implementação e evidências estão no plano específico ao final.
- Persistir somente a transcrição da sessão: texto, tempo das palavras, quem falou
  e revisões. Não persistir áudio em OPFS, IndexedDB, API, banco ou volume Docker.
  O áudio usado pelo reconhecedor deve ser temporário, na própria máquina.
- Separar vozes com NVIDIA Nemotron e identificar profissional e paciente.
  Não inferir a identidade pelo conteúdo clínico da fala. Uma voz ambígua não
  pode virar fala do paciente silenciosamente.
- Histórico recuperado deve manter autoria das falas e das correções. Uma correção
  acrescenta uma revisão; não sobrescreve o registro anterior.
- Insights apenas sobre frases do paciente. Contexto pode esclarecer a frase,
  mas fala do profissional ou de terceiros não vira evidência clínica do paciente.
- Retornar todas as fontes bibliográficas semanticamente e contextualmente
  pertinentes. Não exigir a passagem literal do gabarito nem limitar a um cartão.
- Servidor de prontuário recebe somente cifras. Inferência com texto clínico deve
  ser local. Consentimento de captura e de análise continua obrigatório.
- Resultado de treino, AUROC, similaridade ou precisão de página não certifica
  qualidade clínica do insight. Provar fenômeno, contexto e citação verificável.

## Reconciliação por spec

| Spec | Evidência atual e trabalho restante | Prova necessária para fechar |
| --- | --- | --- |
| S00 Fundação | Monorepo e portões existentes. Nova integração ainda precisa passar os portões completos. | Build, lint, arquitetura, cobertura exigida, contratos e E2E reais. |
| S00.5 Internacionalização | Quatro locales completos: 520 mensagens e nenhuma tradução ausente; compilação estrita e lint sem erros. | Manter os catálogos completos nas próximas integrações. |
| S00.6 Arquitetura/documentação | FSD e ADRs existentes. Atualizar documentação que ainda descreve retenção de áudio. | Dependências válidas, README por módulo e contrato coerente com o produto. |
| S01 Criptografia/chaveiro | KEK real no fluxo profissional. Recuperação BIP39 abre a mesma KEK e o prontuário anterior sem senha antiga, após o segundo fator. Envoltório opaco de 120 bytes; servidor não recebe a frase ou chave clínica. | A recuperação e reabertura de nota assinada passaram em navegador limpo e no app local reiniciado. A revisão externa foi aprovada no JOURNAL de agosto e não deve ser reaberta artificialmente. |
| S02 Identidade/acesso | Senha, 2FA, recuperação, sessão e pareamento ligados em rotas reais. Pareamento confere códigos nos dois dispositivos antes de enviar KEK cifrada; reabre prontuário em navegador limpo, recusa expiração e reutilização. Refresh troca uma vez e revoga família após replay; cadastro TOTP é atômico. Saída e troca de conta revogam família. | Concluir Google e emissor de alerta de novo dispositivo; preservar provas de chaves, saída e concorrência. |
| S03 Pacientes/prontuário | Carteira em pastas por paciente, sessões por identificador de transcrição e notas associadas explicitamente, com nomes decifrados somente no cliente. Acesso por ID/passkey e vínculos entre profissionais comprovados. | Preservar reabertura, RLS, cifras e associação explícita; concluir a partilha consentida. |
| S04 Agenda | Criar, remarcar e cancelar passaram com navegador/API/PostgreSQL reais. O painel abre a preparação da próxima sessão na pasta correta; alterações atualizam a agenda. Criação atômica recusa paciente inexistente ou de outra carteira com o mesmo 404. | Concluir notificação; preservar isolamento, concorrência e início explícito de captura após consentimento. |
| S05 Sessão ao vivo | Interface recebe hipóteses durante a fala pelo WebSocket do Nemotron. AudioWorklet transmite PCM, preserva silêncio e drena a cauda final; pausa desabilita o microfone mantendo o relógio. Captura, pausa, retomada e encerramento passaram no navegador real. Adaptadores legados de retenção de áudio e ASR/WASM sem uso foram retirados. | Preservar a prova de ausência de áudio persistido e de encerramento/limpeza. Medir qualidade em vozes humanas. |
| S06 Diarização/transcrição | Nemotron local separa vozes durante a captura, com confirmação explícita de paciente/profissional. Snapshots cifrados append-only guardam texto, palavras, tempos, papéis, revisão e autor. E2E real salvou, corrigiu e recuperou as duas revisões depois de reiniciar todos os serviços, sem áudio no histórico. | Preservar verificações de conflito, autoria e qualidade de identificação em vozes humanas. |
| S07 Copiloto BYOK | Criptografia de chave e componentes existentes. Referência bibliográfica escolhida exige confirmação humana antes de entrar na avaliação; transferência não grava até salvar/assinar. Recusa revisão substituída, falta de consentimento e origem de outro prontuário. | Conferir o escopo vigente de geração/BYOK e integrar somente o envio autorizado; qualificar o juiz bibliográfico. |
| S08 Notas/biblioteca | Biblioteca ligada às notas reais e assinaturas verificadas. Busca MiniSearch e índice OPFS cifrados por conta. Referência aprovada inclui citação, dados bibliográficos e revisão exata da fala no conteúdo cifrado e assinado. Navegador limpo reabriu a nota e a transcrição original; aprovação/cancelamento preservam a escrita humana. | Preservar assinatura, isolamento e proveniência; prova da interação com fonte sintética não qualifica a pertinência clínica. |
| S09 Painel profissional | Home desbloqueada compõe agenda, sumários, consentimentos e notas reais com assinaturas verificadas. Hoje separado dos próximos dias. Ação principal abre a preparação do paciente e pendência abre a nota exata; alterações atualizam fontes. Captura pendente bloqueia troca. Prova real passou em desktop e celular sem identidade/texto clínico em claro. | Preservar a prova real de abertura, atualização, falhas parciais e acessibilidade. |
| S10 Privacidade/auditoria | Consentimentos reais ligados. Cadeia de auditoria existe sem produtores nos fluxos atuais. | Eventos sem conteúdo clínico, gravação atômica, verificação de cadeia e âncora periódica; revogar interrompe captura/análise. |
| S11 Paciente/partilha | Acesso por convite da carteira e passkey sem e-mail, mesma conta com dois profissionais e check-in com KEK real comprovados. Pareamento de dispositivos concluído em produção. Preferências e emissão de partilha ainda precisam de integração. | Partilha consentida decifra só itens autorizados, independentemente do número de vínculos. |
| S12 Agendamento/cobrança | Cliente/webhook existentes. Implementação de booking identificada em trabalho histórico separado, ausente deste checkout. | Incorporar trabalho válido, reserva/idempotência, cobrança real em sandbox, reembolso e estados de agenda coerentes. Teste que retorna sem credencial não prova o fornecedor. |
| S13 Apoio à medicação | Spec pede apoio e validação legal prévia; não autoriza prescrição ou dose automática. | Reconciliar requisito jurídico registrado, implementar apenas o apoio autorizado e provar integração de histórico/consentimento. |
| S14 Empresarial/portabilidade | Spec antiga de equipe conflita com decisão humana posterior de vínculo direto profissional-paciente. | Resolver pelo contrato vigente, sem inventar acesso clínico de equipe; portabilidade preserva chaves e administração vê somente metadados. |
| S15 Desktop/tablet | Entrega histórica Tauri não está neste checkout. | Recuperar implementação válida e testar build, deep link e navegação real; não tratar smoke sem autenticação como integração completa. |
| S16 Site/SEO | Conferir implementação do workspace público e conexão com agendamento. | Rotas públicas reais, navegação, SEO e acessibilidade; publicar não é requisito para a primeira execução local. |
| S17 Segurança | Portões existentes; parte dos bloqueios antigos era do harness e não da aplicação. | Verificar controles atuais e separar credenciais externas de verificações locais executáveis; não fabricar aprovação de DAST ou revisão humana. |
| S18 Sessão/saída | Tokens persistidos e renovação ligados, KEK só em memória. Saída revoga a família no servidor e retira imediatamente chaves, conta e caches locais. Erro de revogação é visível e permite repetir. | E2E real confirmou 204, rejeição dos tokens antigos, falha de conexão recuperável e purga do índice. Preservar essas provas. |
| S19 Copiloto bibliográfico | Fontes progressivas durante a sessão, sem cotas por obra ou passagem. Cada frase e continuação recebe sua vez mesmo com novas falas; correções invalidam versões antigas. R2 reprovou o limite parcial; R3 em treino de desenvolvimento com rótulos semânticos revisados. Produto segue sem manifesto aprovado, com 503. | Concluir desenvolvimento e qualificação independente sobre o contexto da frase, citações conferidas nos PDFs, todas as fontes pertinentes, silêncio em ambiguidade/erro e isolamento do acervo autorizado. |

## Ordem de execução

1. Fechar o percurso real profissional → paciente → sessão → transcrição cifrada
   → nota → sair → voltar. Corrigir recuperação da chave e concorrência da sessão
   antes de considerar recuperação de prontuário confiável.
2. Ligar biblioteca, painel e agenda existentes aos dados reais. Aproveitar módulos
   já implementados e trabalhos históricos úteis; retirar scaffolds do percurso
   normal. Preservar o sistema editorial compartilhado já aplicado ao frontend.
3. Fechar sessão ao vivo com o serviço Nemotron local atual. Preservar relógio,
   cauda final e pausas. Identificação explícita das pessoas antes de atribuir
   falas; revisão/correção permanece disponível. Retirar retenção do caminho legado.
4. Ligar paciente, recuperação/dispositivos, partilha e portabilidade à mesma
   identidade e às mesmas chaves. Reconciliar decisões humanas posteriores às specs.
5. Concluir fluxos públicos e cobrança com prova real, sem contabilizar skips como
   integrações aprovadas. Ligar produtores de auditoria às mutações efetivas.
6. Qualificar o copiloto bibliográfico e conectar somente quando seus critérios
   forem demonstrados. O trabalho de pesquisa não reduz o escopo do aplicativo.
7. Verificar todos os fluxos de produção, builds e portões previstos. Entregar URL
   local acessível e instruções reproduzíveis, com limitações remanescentes explícitas.

## Plano do copiloto bibliográfico

O protótipo `mvp-copiloto/` fornece pesquisa, índice, retrieval e juiz; não é prova
de integração ao atendimento. A composição aprovada deverá usar a transcrição
canônica do paciente e o acervo autorizado do profissional na própria máquina.

O usuário confirmou explicitamente que os insights devem chegar **durante a
fala do paciente**, sem esperar o encerramento da sessão. O caminho atual usa
hipóteses de transcrição e a fronteira estável de voz do Nemotron. Atualizações
de texto/contexto substituem a consulta pendente; resultados de versões antigas
são descartados. A confirmação de papel permite analisar falas seguintes dessa
voz durante a captura. A revisão final continua necessária para salvar no prontuário.

A integração de transporte/fila está implementada. A API de produto exige
qualificação independente e falha com 503 enquanto falta aprovação; a rota
original do protótipo continua sendo instrumento de pesquisa. Não foi criado
nenhum relatório PASS para contornar o resultado FAIL do juiz existente.

A fila avalia um lote por requisição, dá prioridade às frases novas entre lotes
e alterna a continuação das anteriores. O cursor assinado retoma somente as fontes
restantes e depende da consulta, obras, versão e limiares. Não contém texto do
paciente. Corrigir fala/contexto/papel invalida resultados e cursor; falha retira
todas as fontes dessa fala. Não se reinicia a varredura ao chegar uma nova frase.

1. A seleção de falas fica no cliente: somente trechos identificados como paciente
   seguem para o juiz, com o contexto necessário para resolver elipses, negações,
   citações e referência a terceiros. Não enviar identidade, papel ou embedding de
   voz ao classificador de relevância. Separação acústica e relevância bibliográfica
   são responsabilidades distintas.
2. Percorrer todo o acervo autorizado, sem quota de passagens por obra nem top 10
   antes do juiz. A avaliação acontece em lotes e transmite fontes aprovadas
   progressivamente; medir a primeira fonte e a conclusão completa na máquina alvo.
3. Qualificar fenômeno e contexto, preservar títulos/autores/páginas, conferir a
   citação literal no PDF e desduplicar só a mesma passagem. Fontes diferentes
   pertinentes permanecem. O gabarito deve admitir fontes alternativas revisadas.
4. Calibrar limiar em partições de desenvolvimento independentes por caso/obra.
   Não afinar contra o teste final. Relatar precisão, cobertura, intervalo de
   confiança, latência e falso positivo em fala do profissional/terceiros.
5. Compor cartão revisável com frase do paciente, por que a fonte se aplica e
   citação verificável. Nenhum cartão é diagnóstico, prescrição ou nota assinada.
   Erro, timeout, falta de suporte e ambiguidade devem produzir silêncio explícito.
6. Provar o gate contextual definido no vault com conjunto independente balanceado
   em pt/es/en, negativos difíceis e citações verificadas. Treino por si só, AUROC
   ou uma média alta não substitui esse gate. Persistir a análise apenas com a
   aprovação profissional e sob a DEK do paciente.

## Evidências e pendências de verificação desta execução

- Leitura: inventário local e intervalos consolidados, 436/436 completos.
- Nemotron: serviço loopback; handler oficial lê upload em memória; volume contém
  modelos. A API nova de recordings foi removida e sua rota retorna 404.
- Antes dos snapshots de transcrição: 53 verificações de sessão/prontuário/Home
  passaram, incluindo ausência de acesso a armazenamento persistente para áudio.
- Os snapshots novos acrescentam palavras, tempos, papéis, revisão, autor e data
  cifrados, sem campo de áudio. A suíte completa passou 892 testes antes das últimas
  verificações de proteção; o portão de cobertura inicialmente acusou lacunas.
  Após testes de escrita, retomada, conflito, descarte e ciclo de vida, 85 testes
  focados passaram com 100% nas quatro métricas de SessionReview, PatientCare e
  parser de transcrição. A repetição completa passou 899 testes em 107 arquivos,
  com 100% nas quatro métricas, além de typecheck, lint e arquitetura sem erro.
  UI real, restart e catálogos ainda precisam ser verificados; esses números
  não certificam fechamento de todo o produto.
- O filesystem read-only e `/tmp` em RAM do serviço Nemotron foram aplicados e
  conferidos no container. Uma transcrição real de áudio sintético retornou 64
  palavras e duas vozes nessa configuração; `/tmp` permaneceu vazio.
- Treino contextual terminou as três partições com AUROC OOF 0,933. Isso não
  demonstra aprovação do gate clínico nem autoriza conectar o juiz como confiável.
- Recuperação concluída: testes reais de cifra reabriram entradas sob a mesma
  DEK; API validou tamanho, armazenamento e retorno do envoltório. O E2E criou
  profissional, confirmou TOTP, registrou verificação documental, criou paciente
  fictício e assinou nota. Um segundo navegador recuperou a KEK somente com frase
  e segundo fator e abriu essa nota assinada. Passou em 390, 768 e 1440px.
  No navegador do app local, a mesma recuperação abriu a nota antiga depois de
  reiniciar API e interface. Nenhuma frase de recuperação foi incluída nas capturas.
- API: 778 testes aprovados, sem skips, com 100% de linhas, branches e métodos.
  Inclui corrida de refresh e partilha/desvinculação. O instante de desvinculação
  agora é produzido no banco depois de adquirir o lock da relação.
- App: 917 testes em 108 arquivos, com 100% nas quatro métricas; build real
  `tsc -b && vite build`, lint e arquitetura aprovados. Esse build substitui a
  verificação anterior somente por `tsc --noEmit` sobre o tsconfig raiz vazio.
- Frontend: 78 E2Es de rotas reais, quatro idiomas e três tamanhos, sem overflow
  horizontal e sem violações axe; 20 CTs do app; 195 CTs das primitivas e 25
  casos não aplicáveis a seus breakpoints. Site: build, 9 unitários e 13 E2Es.
  As provas visuais abrangem os estados descritos no plano editorial; biblioteca
  populada, sessão ao vivo e juiz qualificado ainda dependem das integrações acima.
- Sessão ao vivo, verificação posterior: 992 testes do app em 115 arquivos,
  com 100% nas quatro métricas; build TypeScript/Vite aprovado, lint e arquitetura
  sem erros. API: 784 testes, sem skips, 100% de linhas, branches e métodos,
  incluindo corrida real de inicialização TOTP em PostgreSQL. Catálogos: 304
  mensagens por locale e nenhuma tradução ausente.
- Nemotron por streaming: fixture sintética PCM16 mono a 22.050 Hz, 34,943 s,
  enviada na velocidade da fala. Primeiras palavras em aproximadamente 2,8 s;
  duas vozes identificadas em aproximadamente 11,1 s, ainda durante o envio.
  Resultado final de 63 palavras e duas vozes; `/tmp` vazio. Esses números provam
  transporte/diarização da fixture, não precisão clínica em vozes humanas.
- E2E local da sessão: navegador Chromium, API/PostgreSQL e Nemotron reais,
  conta e paciente fictícios. Confirmou consentimentos, palavras chegando durante
  captura, papéis explícitos, pausa/retomada, revisão, salvamento cifrado, saída,
  novo login/TOTP e reabertura com a mesma contagem de palavras e sem áudio.
  Capturas e log em `.local/live-session-results/` e `.local/live-session-e2e.log`.
- Insights: seleção exclusiva de fala estável do paciente, fila que substitui
  hipóteses pendentes e descarte de resultados antigos implementados. A rota de
  produto retorna 503 porque o juiz ainda não tem qualificação independente;
  o E2E exibiu esse estado. Não há cartões qualificados aprovados nesta prova.
- Entrega progressiva posterior: fontes avaliadas em lotes e transmitidas durante
  a consulta, sem corte por quantidade de obra/passagem. A fila prioriza a fala
  atual e cancela hipóteses antigas. 25 regressões Python passaram. Após retirar
  o caminho de áudio persistido, 936 testes do app em 106 arquivos passaram com
  100% nas quatro métricas; build, lint e arquitetura sem erro. A diferença de
  contagem inclui a retirada dos testes exclusivos dos adaptadores obsoletos.
- Treino: foram identificados rótulos negativos sem adjudicação em fontes
  alternativas pertinentes. O treino revisado excluiu 23.140 pares de rótulo
  fraco/desconhecido e usa 6.672 exemplos. As três partições terminaram. A
  calibração fora-da-parte do desenvolvimento selecionou 0.964, com precisão de
  96,02% e limite inferior de Wilson de 95,06%; isso não é aprovação clínica.
  O ajuste final dos pesos terminou. A avaliação independente de 200
  casos e obras sem sobreposição com o treino foi preparada com régua congelada.
  Não houve liberação do juiz.
- Verificação posterior: 956 testes do app em 109 arquivos, 100% nas quatro
  métricas; build, lint e arquitetura aprovados. Catálogos com 310 mensagens por
  idioma, sem tradução ausente. Biblioteca real passou no navegador em desktop
  e celular sem overflow ou violação axe, usando nota assinada, busca sem saída
  do termo por rede e purga do índice cifrado ao sair.
- Transcrição após reinício: os serviços locais foram encerrados e iniciados
  novamente. Novo login/TOTP recuperou a mesma contagem de palavras, a correção
  e a revisão original, sem áudio. Logs em `.local/transcricao-restart-e2e.log`.
- Integridade do juiz: a versão inclui o índice real, além de código, pesos e
  PDFs. Mudança dos artefatos antes ou durante a consulta bloqueia ou interrompe
  o streaming; respostas incompletas retiram os cartões parciais. O serviço local
  atual usa esse contrato e permanece com `qualificado=false`/HTTP 503.
- Avaliação revisada interrompida após o primeiro caso independente: 746 referências,
  primeira fonte em 5.276,5 ms e conclusão em 476.506,3 ms. Quatro passagens revisadas
  sobre uso de crack não correspondem ao entorpecimento após uma morte da fala;
  outras 742 não foram adjudicadas. Não se estima precisão desse conjunto parcial
  nem se ajusta o limiar por ele. Pesos não publicados. Registro em
  `mvp-copiloto/resultados/qualificacao-gte-contexto-revisado/diagnostico-parcial.json`.
- Auditoria do desenvolvimento encontrou 979 falas com fonte positiva, mas somente
  31 com uma fonte negativa explicitamente revisada. Falas neutras/negações não
  substituem contrastes de documento para uma fala clínica. Corrigir os rótulos
  de fontes no desenvolvimento antes de novo treino; não transformar as alternativas
  desconhecidas em negativos nem reciclar o caso independente observado para treino.
- Seleção de citações agrupada, com cache limitado a 4.096 passagens bibliográficas
  em memória. Não guarda as falas do paciente nesse cache. Em 20 fontes sintéticas
  de desenvolvimento, selecionou as mesmas citações literais: 19.193,4 ms no caminho
  sequencial, 10.951,9 ms no primeiro lote e 178,3 ms com as fontes já codificadas.
  Isso mede essa etapa, não a latência ou qualidade do insight completo. Quatro
  testes do lote e 26 regressões de confiabilidade passaram.
- Saída verificada: API 790 testes sem skips e 100% de linhas/branches/métodos;
  app 966 testes em 110 arquivos e 100% nas quatro métricas. Build TypeScript/Vite,
  lint, arquitetura e 312 traduções por idioma aprovados. E2E real de saída simulou
  uma falha de conexão, confirmou retirada das chaves/conta/índice local, repetiu a
  revogação com 204 e verificou access e refresh antigos rejeitados com 401.
  Estado de falha também passou em 375px, sem overflow ou violação axe.
- Revisões de fontes: 74 pares de 63 casos de desenvolvimento em três idiomas,
  com 67 fontes incompatíveis e sete alternativas pertinentes. Hashes vinculam
  fala/contexto e passagem à decisão. A revisão substitui o rótulo antigo e
  preserva a partição do caso; desconhecidos não viram negativos. A calibração
  exige agora aprovação estatística separada nos contrastes de documento da
  mesma fala, evitando uma média dominada por casos fáceis. Cinco testes de
  fontes e quatro de calibração passaram. As 28 regressões posteriores de
  confiabilidade incluem a marcação de contraste e a continuação das fontes.
- Diagnóstico de 134 pares: revisado aprovou 89 no limiar 0.964, incluindo 24
  incompatíveis; GTE base aprovou zero nesse limiar; Qwen base aprovou 15 com uma
  incompatível. Positivos canônicos podem ter participado do treino. É diagnóstico
  de desenvolvimento, sem aprovação clínica nem mudança de modelo ativo.
- Continuação de insights: 973 testes do app e 100% nas quatro métricas;
  build TypeScript/Vite, lint e arquitetura aprovados. Python: 28 regressões
  de confiabilidade, três de continuação, três de integridade e três de gate
  passaram. Cursor rejeita outra fala/contexto, obra, versão, limiar, adulteração
  ou reinício. O E2E de composição mostrou cinco referências durante captura
  Nemotron real em 19,9 segundos; as referências foram fixtures do navegador,
  explicitamente sintéticas, e não constituem qualificação do juiz.

## Ampliação do goal para a V1

Transcrição integrada implementada e verificada: 980 testes do app passaram,
100% nas quatro métricas; build, lint e arquitetura sem erros, 319 mensagens
completas por idioma. O E2E com captura Nemotron real comprovou tracejado por fala,
clique/teclado, foco no balão, cinco referências sintéticas e retorno ao trecho.
Desktop e 375px sem overflow/violações axe. Fontes eram fixtures explícitas;
juiz clínico continua sem qualificação. Log: `.local/insights-transcricao-e2e.log`.
O inicializador foi corrigido para iniciar interface/API junto do carregamento
do acervo, sem encerrar o produto por um prazo arbitrário de aquecimento do juiz.

O pedido de 3 de outubro acrescenta sessão presencial e online, cadastro cifrado
da voz do profissional, transcrição editorial com ligação por trecho aos insights,
e acesso/vínculos do paciente por identificadores opacos, sem e-mail. Os critérios
vigentes estão em [V1](v1-criterios-de-aceite.md). O acesso por e-mail da spec antiga
foi substituído pelo pedido. Convites anônimos por ID, sessão online e qualificação
clínica permanecem pendentes; não são comprovados pelos testes do cadastro de voz.

Cadastro de voz implementado em `/settings/voice`: captura de 15 s só em memória,
consentimento e permissão do microfone, três linhas, recusa de silêncio/variação,
substituição e remoção. TitaNet Large executa num worker WebAssembly e o servidor
recebe apenas DEK envelopada (60 bytes) e perfil cifrado (796 bytes), com AAD por
conta e hash do modelo. A sessão usa PCM limitado a 60 s e falas de locutor estável,
sem esperar o commit lexical. O perfil recuperado em outro navegador reconheceu
as duas vozes sintéticas durante captura real em 25,4 s, sem seleção manual;
zero uploads de áudio do cadastro e zero violações axe desktop/375px.
Isso não qualifica vozes humanas. Evidência: `.local/voz-perfil-v1-prova.json`,
`.local/voz-perfil-v1-e2e.log` e [plano](superpowers/plans/2026-10-03-perfil-voz-profissional.md).
App atual: 1.079 testes em 116 arquivos e 100% nas quatro métricas. Diarização:
80 testes e 100%; build, lint e dependências sem erros; 344 mensagens por idioma
com compilação estrita. Logs: `.local/voz-app-completo.log`, `.local/voz-build.log`,
`.local/voz-classificacao-testes.log`, `.local/voz-traducoes.log`.

Primeira etapa do acesso por ID: geração de convite consulta a existência do
prontuário sob RLS da mesma carteira. IDs inexistentes e pertencentes a outro
profissional retornam `404 patients.not_found`. O histórico não é carregado para
essa decisão. 93 testes focados passaram; API completa: 792 testes, nenhum skip,
100% line/branch/method. Logs: `.local/convites-carteira-testes.log` e
`.local/convites-api-completo.log`. O plano de remoção do acesso por e-mail está em
[acesso por ID](superpowers/plans/2026-10-03-acesso-paciente-por-id.md), ainda em execução.

## Próxima tarefa de frontend

Atualização funcional posterior: o acervo profissional aceita PDF/TXT cifrados e autorização explícita; o motor local reconstrói o índice em RAM a partir de arquivos decifrados, revalida propriedade/autorização e purga ao revogar. Upload, consulta, download, reinício do índice, isolamento e exclusão passaram em navegador real. Não implica qualificação clínica do juiz. Contrato e evidências em [acervo profissional](acervo-profissional.md).

Agenda e acervo integrados: API com 883 testes e 100% de linhas/ramos/métodos; app com 1.235 testes em 130 arquivos e 100% nas quatro métricas, build, arquitetura, lint e traduções estritas aprovados. A sessão online passou novamente com Nemotron real em 14,8 s. Atualizações da conta agora usam mutação atômica sob lock, preservando alterações concorrentes de voz, recuperação e segundo fator. Evidências: `.local/agenda-api-completo.log`, `.local/agenda-app-completo.log`, `.local/agenda-v1-prova.json`, `.local/acervo-e2e-prova.json` e `.local/online-v1-prova.json`. O juiz continua em correção e treinamento; estes testes não liberam insights clínicos.

Atualização em 4 de outubro: API anônima com 814 testes e 100% linha/ramo/método;
app com 1.099 testes e 100% nas quatro métricas. Cadastro, duas asserções WebAuthn
com PRF, recuperação do check-in cifrado, segundo vínculo, isolamento de carteira
e revogação de convite passaram em navegador real + Postgres. Pacientes no banco
não têm e-mail, verificadores de senha ou Google. Detalhes e limites no
[plano por ID](superpowers/plans/2026-10-03-acesso-paciente-por-id.md) e
`.local/paciente-id-prova.json`. Quatro catálogos: 359 mensagens, compilação estrita.
Sessão online segue o [plano](superpowers/plans/2026-10-04-sessao-online.md).
O juiz clínico continua reprovado na qualificação independente e bloqueado;
nenhuma prova de interface ou passkey foi tratada como aprovação clínica.

O usuário forneceu uma nova referência visual e pediu sua aplicação em todas as
páginas como próxima tarefa. O [plano editorial](superpowers/plans/2026-10-02-frontend-editorial.md)
foi salvo junto da [referência integral](design/frontend-editorial-reference.md).
A tarefa local de implementação `01a0ff16-5f9f-7730-b757-2be4b82ebcb1` implementou
tokens, fontes, primitivas e site. A tarefa principal fechou depois os títulos das
páginas, build TypeScript, traduções e provas com sessão real. A autorização
substituiu o adiamento visual; os fluxos funcionais pendentes continuam registrados
acima. Capturas locais atuais: `.local/capturas/` e
`.local/recovery-e2e-results/`. Entrada do app: `http://localhost:5173`.

Referências que corrigem conclusões antigas: tickets S06-05/S06-06, handoff S06 de
9 de setembro às 23:20, JOURNAL de 7 de setembro sobre escritor de índice inexistente,
decisão S11 de 14 de setembro sobre vínculo direto, e handoffs S19 de 30 de setembro
às 11:19 e 11:40 sobre identificação explícita, relógio e contrato textual do juiz.

Atualização de integração em 5 de outubro: painel abre paciente, preparação e nota
pendente a partir das fontes reais; consentimento, agenda e assinatura atualizam
a interface. Referência exige aprovação explícita, preserva a escrita humana,
é cifrada e assinada e abre sua revisão original. A fila dá vez a cada frase e
às fontes restantes durante chegada contínua de falas. App: 1.322 testes em 135
arquivos, 100% nas quatro métricas; build, TypeScript e arquitetura sem erros.
Quatro cenários permanentes de pareamento/referência passaram com cadastro real.
Logs: `.local/fila-app-completo.log`, `.local/fila-insights-equidade-tests.log`,
`.local/referencia-build.log`, `.local/referencia-arquitetura.log`,
`.local/referencia-pareamento-production-e2e.log`, `.local/painel-v1-e2e.log`.
Essas provas não qualificam o juiz: a fala/bibliografia do cenário de aprovação
é sintética. R3 segue em desenvolvimento; os critérios clínicos foram mantidos.

## Estado em 6 de outubro de 2026

Juiz R3 (`qwen-frase-r3`), partição 0 concluída: AUROC fora da partição 0,981.
Em todos os pares de desenvolvimento, limiar 0,99 dá precisão Wilson 0,953 com
recall 0,63; limiar 0,995 dá 0,967 com recall 0,53. Nos contrastes de fonte, o
piso Wilson 0,95 é inalcançável só com a partição 0: o teto otimista é 0,944,
limitado pelo número de positivos (65), não por erros acima do limiar. Treino
completo (três partições + pesos finais) iniciado; log em
`.local/juiz-frase-r3-completo.log`. Depois: `avaliar_limite_parcial.py`,
calibração e `qualificar_revisado.py` no conjunto independente. O gate
`/api/consultar-qualificado` segue fechado até essa prova passar.

E2E `online-permissoes.spec.ts` ainda falha: o alerta de microfone negado não
aparece no Chromium de teste. Validação pendente com navegador real.

Triagem por frase trocada de regressão logística para SVM RBF (C=10, gamma=1)
sobre os mesmos vetores, inferência em numpy (`treinar_triagem_rbf.py`,
`modelos/juiz-local/triagem-frase-rbf/rbf.npz`). Fora da partição, no mesmo
recall (clínica 0,98, risco 0,95, ambígua 0,90), falsos alertas caíram de
18,6% para 6,8% (clínica), 50,4% para 16,1% (risco) e 18,4% para 1,1%
(ambígua). Medição só em desenvolvimento; a prova independente segue pendente.

Sinalização online: o servidor anunciava `peer-ready` duas vezes quando os dois
participantes entravam juntos, e a segunda resposta SDP derrubava a chamada.
`OnlineSessionRoom.Join` agora informa a presença do par na mesma trava. E2E
`online-permissoes.spec.ts` passou (microfone negado, reconexão após recarregar,
convite revogado). API: 884 testes, 100% de cobertura.

## Corte de escopo da V1 (6 de outubro de 2026)

Decisão do usuário: fechar a V1 com o que faz sentido para o uso clínico local e
abandonar o resto. Fica na V1: S00–S06, S08, S09, S18 e S19 (juiz qualificado),
além do acesso do paciente por convite/passkey (S11) e do acervo do profissional.

Fora da V1 (reabrir só por decisão explícita, não como dívida silenciosa):

- S12 agendamento público e cobrança; S13 apoio à medicação; S14 empresarial;
  S15 desktop/tablet; S16 publicação do site.
- S02 login com Google e e-mail de alerta de novo dispositivo; S04 notificações.
- S07 geração BYOK por provedor externo: o copiloto da V1 é bibliográfico e local.
- S10 produtores da cadeia de auditoria; S11 preferências e emissão de partilha.

Treino e qualificação do juiz passaram a rodar numa RTX 3090 alugada na Vast.ai
(a GPU local de 6 GB derrubava o treino). Só código, acervo de desenvolvimento e
casos sintéticos vão para a VM; nenhum dado de paciente.

### R3 completo na RTX 3090 (7 de outubro de 2026)

Treino integral (três partes e pesos finais) em ~2 h na Vast.ai, custo ~$0,40.
AUROC fora da parte 0,983. Calibração reprovada: no limiar 0,98 o conjunto geral
atinge Wilson 0,950 com recall 0,69, mas os contrastes de fonte ficam em Wilson
0,747 (49 de 57 aprovados corretos). Com 81 positivos nesse subconjunto, o piso
de 0,95 exige ao menos 73 aprovações sem nenhum erro; o subconjunto é pequeno
demais para a régua. Parte dos negativos de maior nota parece pertinente
(insônia/concentração, catastrofização ansiosa), indicando rótulo a revisar.
Qualificação independente não foi executada; o juiz segue bloqueado (503).

### R4 com contrastes revisados (7 de outubro de 2026)

Contrastes de fonte ampliados para 515 pares (373 positivos) por revisão manual
cega à nota do juiz. R4 = configuração do R3 sobre esses rótulos; AUROC fora da
parte 0,967. Calibração reprovada por pouco: no limiar 0,99 o conjunto geral
atinge Wilson 0,951 (recall 0,43) e os contrastes de fonte 0,945 (205 de 210
aprovados corretos, recall 0,55); nenhum limiar atende os dois pisos. A
qualificação independente não foi executada e o juiz segue bloqueado (503).
Instância destruída; crédito restante na Vast ~$3,90.

### R5, peso 8 nos contrastes (7 de outubro de 2026)

Mesmos rótulos do R4 com `peso_contraste_fonte` 8. AUROC fora da parte 0,975.
Calibração reprovada: limiar 0,99 dá Wilson geral 0,966 (recall 0,44) e
contrastes de fonte 0,930 (194 de 201); 0,995 dá 0,978 e 0,940. O melhor
candidato de 0,6B continua sendo o R4 (0,945 nos contrastes). O juiz segue
bloqueado (503); qualificação independente não executada. Instância destruída.

## Fecho da V1 (7 de outubro de 2026)

Régua do juiz redefinida pelo usuário (ver `v1-criterios-de-aceite.md`): Wilson ≥ 0,88
e recall ≥ 0,70 no conjunto geral e nos contrastes de fonte; cobertura ≥ 0,70 na
qualificação. O R4 atendia essas metas nos OOF guardados (corte ~0,89–0,91) e está
sendo retreinado na Vast para a qualificação independente, pois os pesos não foram
guardados da primeira vez.

Unidade de análise: frase do paciente com as frases anteriores dele como contexto,
mais uma passada final sobre a fala inteira (`entities/insight/turnos-paciente.ts`).

Módulos locais que estavam implementados mas sem ligação foram ligados:

- S10 auditoria: produtores reais (entrada, saída, prontuário aberto/acrescentado,
  nota assinada, exportação), âncora a cada 50 entradas, `GET/POST /accounts/{id}/audit`
  e a tela `/settings/audit` com filtro por data, estado da cadeia e CSV.
- S11 partilha: `PartilhaCheckIns` em `/hoje` (paciente) e `EspelhoP6` em `/espelho`
  (profissional), com a KEK da sessão; antes só existiam pela rota de E2E.

Pendente por decisão humana: exportação e eliminação a pedido do titular (S10). O
servidor guarda só cifras e o prontuário é append-only; apagar conflita com a guarda
mínima do prontuário exigida pelo CFP, e a forma de cumprir a LGPD aqui é jurídica.

### Qualificação independente do R4 (7 de outubro de 2026, interrompida)

A calibração passou na régua nova (corte 0,891; Wilson 0,881 geral e 0,880 nos
contrastes). Nas obras de teste, que o juiz nunca viu, ele aprovou em média 218
passagens por fala (15.043 cartões em 69 casos), incluindo artigos de suicídio
com nota 0,99 para falas sem relação; o risco foi sinalizado em só 56%. A
qualificação foi interrompida em 69/200 e a instância destruída; os registos
estão em `.local/vast/qual-r4/`. O juiz segue bloqueado.

Causa: as partições do desenvolvimento separam frases, não obras. As mesmas PDFs
aparecem no treino e na validação fora-da-parte, então a calibração mede
memorização das obras. Como o acervo do profissional é sempre material novo, o
próximo juiz precisa ser calibrado com partição por obra antes de qualquer GPU.
