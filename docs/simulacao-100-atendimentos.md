# Ensaio de 100 atendimentos — evidências

Ensaio em execução, iniciado em 15/10/2026. As contagens finais dependem dos registros efetivamente concluídos; este documento não declara 100 atendimentos concluídos.

## Contrato

- Conta, pacientes e áudios são fictícios. Duas vozes TTS locais em português, com ASR e identificação reais quando indicados.
- Cada roteiro tem cinco obras pertinentes, selecionadas do corpus público por tema e alternadas entre casos.
- Upload pelo aplicativo mantém cifra e permissões. Indexação usa o serviço verdadeiro.
- Duração de áudio, tempo efetivo e eventuais fronteiras simuladas são registrados separadamente.
- Material público obtido do PMC Cloud Service, com licença individual, título, autores, DOI e hash no manifesto local. Pesquisa científica não equivale a recomendação clínica.
- Milhões de linhas geradas não equivalem a milhões de exemplos independentes ou revisados. Nenhum modelo é promovido apenas pelo tamanho do treino.

## Defeitos encontrados

| ID | Evidência | Efeito | Correção / verificação |
|---|---|---|---|
| D01 | Cadastro real retornou HTTP 500; Postgres `relation accounts does not exist`; `has_schema_privilege(app_role,public,USAGE)=false` | Reset recriava schema sem acesso da API; health/db retornava 200 enganoso | Reset passa a restaurar USAGE apenas a app_role; permissão local corrigida sem apagar dados. Cadastro real repetido e aprovado. |
| D02 | Ensaio anterior parou esperando `Cadastrar minha voz` com perfil já cadastrado | Fixture preencheu o perfil sintético; roteiro esperava cadastro vazio | Ajustar roteiro para cadastrar a voz na etapa obrigatória ou substituir explicitamente um perfil existente. Não é falha do ASR. |
| D03 | Auditoria do juiz: 17 fontes e 142 falas sobrepostas no teste fixo histórico | Métricas históricas não demonstram separação por fonte/família | Manter teste congelado; criar candidato e divisão independente, sem promoção automática. Auditoria em `.local/simulacao-100/judge-audit.json`. |
| D04 | 181 respostas 429 no preparo durante 200 uploads; erro local desaparecia na consulta de progresso | Arquivos parados pareciam apenas aguardar preparo | Preservar estado local; fila automática que decifra um arquivo por vez, respeita capacidade e recua entre tentativas. Limite do servidor mantido. |
| D05 | Teste reproduziu envio liberado com buffer de rede vazio e 10 s não processados; gateway mantém apenas 30 s de áudio para identificar vozes | Arquivos longos podiam apagar o áudio necessário antes da atribuição de falante | Envio de arquivo aguarda fronteira processada; ausência de progresso falha em 30 s. 49 testes focados aprovados. Falas contínuas muito longas e reconexão ainda exigem avaliação real. |
| D11 | Playwright exibiu uma referência em neerlandês como citação clínica com nota do juiz de 97,0% | Item bibliográfico passou pelo filtro de citação de 6–30 palavras e apareceu como insight | Trechos que começam com ano entre 1900 e 2099 agora são excluídos; 9 testes de citação passaram e o hash do juiz no serviço ativo corresponde ao arquivo. A inspeção visual pós-correção segue pendente porque reiniciar o índice exige preparar novamente as fontes. |
| D12 | Entrada TTS de 60 s pelo microfone do navegador levou 896–2.850 ms para mostrar as seis primeiras palavras/frases medidas | O alvo de até 300 ms falhou em todas as seis amostras; o limitador ainda não foi isolado | O teste percorreu o capturador do browser, gateway e Nemotron; monitor registrou 19,5–70,0% de GPU e juiz em 2.684 MiB de RAM. Antes de escolher otimização, medir todas as palavras com alinhamento de áudio e perfil por serviço. A transcrição teve WER 2,73% (3 edições/110 palavras) em TTS, não em fala humana. Evidência em `.local/simulacao-100/live-browser-60s.json`. |

## Regras de materiais solicitadas durante o ensaio

- Não preparado: autorização desabilitada, somente exclusão visível, ausência da seleção da sessão.
- Preparo automático com espera por capacidade; nenhuma fila de centenas de PDFs abertos em memória.
- Reserva durável cumulativa das obras antes de usar o áudio; acréscimo atômico da seleção e bloqueio de exclusão na API enquanto houver sessão em andamento.
- Encerramento libera a reserva. Navegar entre abas ou fechar o navegador não libera uma sessão que ainda não foi encerrada.

## Recursos

Amostragem contínua em `.local/simulacao-100/recursos/amostras.jsonl` e resumo em `resumo.json`: processos por porta, navegador do Playwright, contêineres de Postgres e Nemotron, memória da máquina e GPU. CPU de processo registra percentual de um núcleo e da máquina inteira; os valores do Docker mantêm sua unidade original. Working sets compartilham páginas e não devem ser somados como memória física exclusiva. O driver Windows retorna memória por processo GPU como indisponível; a GPU é registrada como total do dispositivo, sem inventar atribuição por serviço.

## Aquisição de materiais

Fonte oficial: [PMC Open Access Subset](https://pmc.ncbi.nlm.nih.gov/tools/openftlist/) e [PMC Cloud Service](https://pmc.ncbi.nlm.nih.gov/tools/pmcaws/). Manifesto incremental em `.local/simulacao-100/materiais/manifest.json`; arquivos não são incluídos no Git.

## Retomada de 16/10/2026

- Serviços encerrados e navegador sem o estado temporário anterior. Nova conta fictícia criada pelo MCP visível; kit e credenciais exclusivamente de ensaio guardados em `.local/simulacao-100`, ignorado pelo Git. Nenhum reset adicional.
- Cadastro, TOTP, chave pessoal, cadastro obrigatório de voz com WAV sintetizado real e aprovação administrativa exclusivamente local repetidos com sucesso.
- 214 PDFs públicos no manifesto; seleção de cinco obras em cada um dos 100 roteiros refeita com critérios conservadores de título/população. Áudios e turnos preservados; `scenario.json.sources` é a seleção atual e a seleção em `expected.json` é histórica. Triagem de títulos não substitui revisão clínica.
- 189 testes focados da interface passaram; TypeScript, lint dos três componentes modificados, compilação estrita de traduções e nove testes dos geradores/corpus passaram.
- 20 testes focados da API passaram. O comando filtrado reprovou no requisito global de 100% de cobertura; a suíte completa ainda deve ser executada.
- D06: criação não idempotente da tabela de reservas impedia reiniciar o app com banco existente. Corrigida para o padrão idempotente das demais migrações; reinício real aprovado, dados preservados.
- D07: início de áudio enquanto a bibliografia carregava podia usar seleção incompleta. Entrada de arquivo e gravação aguardam carga; regressão coberta.
- D08: falha na liberação das obras após salvar encerramento podia deixar reserva presa depois de recarregar. Reabertura de sessão encerrada retoma a conclusão; regressão coberta.
- D09: duas abas do mesmo atendimento permitem encerramento concorrente liberar obra ainda capturada. Correção adicional em andamento com controle de captura no servidor; ainda não declarar resolvido.
- 100 WAVs gerados não representam 100 atendimentos executados. Até este checkpoint, nenhuma transcrição completa do lote foi concluída. Nenhum novo modelo treinado em milhões de exemplos nem melhoria de aceitação comprovada.

### Verificação ampliada da retomada

- 214 uploads reais concluídos na nova conta; paginação real verificada de 1/22 para 2/22, dez itens visíveis. Screenshot local `acervo-214-paginado.png`. Nos dez itens pendentes inspecionados, autorização desabilitada e somente excluir disponível. DOM da página: 198 elementos; heap JS observado: 50.949.653 bytes (não é memória total do navegador).
- D09 implementado com capturas por execução, transações/RLS, marcador de encerramento que impede novas capturas, e liberação recusada enquanto qualquer captura estiver ativa. Recuperação de órfãs usa Web Locks; IDs sem chave/token guardados no navegador. Tombstone de captura impede aquisição atrasada após liberação. Nova migração 0021 aplicada no ambiente.
- D10 da revisão: rejeição ao abrir/encerrar ASR pulava a liberação após transporte já fechado. Finalização agora aborta transporte, encerra trilhas próprias e só então libera; falha HTTP tem repetição. 171 testes focados de captura/transporte aprovados.
- Acervo: 47 testes aprovados, incluindo prioridade para obras já autorizadas na restauração do índice e ordem de chegada entre obras de igual prioridade.
- Suíte completa da API: 974 testes aprovados. Cobertura 99,94% linhas e 97,84% ramos; requisito 100% ainda não atendido e não foi reduzido. Saída em `.local/simulacao-100/api-full-project-tree-test.log`. Saída de testes deve ficar dentro da árvore de Api.Tests para os resolvedores de fixtures atuais.
- Índice e textos do acervo são mantidos em RAM pelo serviço; reiniciá-lo exige preparar os materiais novamente. Os PDFs continuam cifrados no banco, sem reset adicional. Não interromper o serviço bibliográfico durante o lote.
- Candidato de pesquisa CPU iniciado separadamente; ainda sem resultado registrado neste checkpoint. Não é ajuste do juiz de produção nem treino com milhões de exemplos. Monitor registra o processo em `treino_candidato_cpu`.
- Harness sequencial iniciado com checkpoints; ainda aguardando preparo das cinco obras do primeiro caso. Contar somente `completed=true` com evidência de transcrição, nota e encerramento em `lote-checkpoint.json`.

### Candidato de pesquisa e gargalo de ASR

- Treino de cabeça logística sobre E5 congelado efetivamente concluído em CPU: 314 pares de treino, 139 de desenvolvimento, 101 de teste e 810 embeddings únicos. Não é fine-tuning do Gemma de produção nem milhões de frases. No teste: AUROC 0.526611, Brier 0.146253, aprovação a 0,9 igual a zero. Resultado sem ganho confiável; candidato não promovido. Artefatos e previsões em `.local/simulacao-100/candidate-cpu/`.
- D11 de desempenho: primeira tentativa CPU foi interrompida com 158,56 s processados, sem conclusão. Evidência preservada em `sessao-001-cpu-parcial.json`; não conta atendimento concluído. Fluxo configurado para Nemotron CUDA já suportado, busca BGE em CPU e juiz na GPU, para caber na placa de 6 GB. Medir nova configuração antes de atribuir aceleração.
- Validação do corpus ampliado: 214 PDFs distintos, 212 CC BY e dois CC0, 2.655 páginas, 184.410.432 bytes, hashes e extração das primeiras páginas verificados. Avisos de metadados PDF duplicados do parser não impediram extração; os originais públicos e seus hashes foram preservados.
