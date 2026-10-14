# Limmiar V1 — escopo vigente

Atualizado em 4 de outubro de 2026 por solicitação do usuário. Este documento
acrescenta requisitos ao goal existente; não representa implementação concluída.
Substitui o adiamento de design e o acesso do paciente por e-mail das specs antigas.

## Sessão presencial e online

- Presencial: profissional e paciente compartilham o microfone; diarização separa
  as falas e reconhecimento de voz identifica o profissional cadastrado.
- Online: o paciente entra pelo convite do profissional, sem fornecer nome,
  e-mail ou telefone ao serviço. Permissão de microfone é solicitada em cada
  dispositivo; recusa, silêncio, desconexão, reconexão e encerramento têm estado visível.
- Áudio online usa WebRTC com transporte cifrado. A origem de cada trilha determina
  o papel; não se mistura a fala do profissional ao texto enviado ao copiloto.
- Provar duas páginas/dispositivos reais, fala nos dois sentidos, permissões,
  encerramento e transcrição com os papéis corretos durante a chamada.

## Voz do profissional

- Configurações permitem cadastrar, substituir e excluir o perfil de voz.
- Captura guiada inicial de 15 segundos é uma escolha de interface a validar,
  não um mínimo de precisão declarado pela NVIDIA. Amostra sem fala ou com mais
  de uma voz deve ser recusada. Mostrar três linhas de texto de leitura.
- Nemotron 3 Diarization mantém locutores anônimos por ordem de chegada dentro
  da sessão. Reconhecimento entre sessões requer um extrator de identidade
  separado, como TitaNet. Não comparar seus canais de diarização como embeddings.
- Perfil extraído no dispositivo, cifrado pela KEK com DEK/AAD por conta antes
  de persistir. Nunca salvar a gravação de cadastro, nem a voz do paciente.
- Classificação precisa de correspondência absoluta, separação entre candidatos
  e tratamento de desconhecidos. Uma terceira voz não vira paciente automaticamente.
  Validar mesma voz em gravações independentes e recusar vozes não cadastradas.

Fontes oficiais consultadas: [integração Nemotron](https://huggingface.co/nvidia/Nemotron-3-Diarization/blob/main/ASR_INTEGRATION_GUIDE.md),
[reconhecimento NeMo](https://docs.nvidia.com/nemo/speech/nightly/asr/speaker_recognition/intro.html),
[API de reconhecimento](https://docs.nvidia.com/nemo/speech/nightly/asr/speaker_recognition/api.html).

## Transcrição e insights

- Aplicar a referência editorial existente à transcrição ao vivo: papel creme,
  tipografia serifada nos títulos, metadados mono, bordas finas, sem sombras.
- Mostrar fala profissional, paciente, desconhecida e hipótese em andamento sem
  descartar palavras. Apenas fala estável identificada como paciente é analisada.
- Analisar cada frase estável do paciente. O objeto da análise é o sentido da
  frase atual, incluindo negação, sujeito, citações e circunstâncias nela expressas.
  Falas anteriores apenas resolvem referências e elipses; não substituem a frase
  atual nem autorizam inferir sintomas a partir do histórico da pessoa.
- Quando uma fala tiver um ou mais insights qualificados, sublinhar essa fala
  com tracejado. Clique ou teclado abre e focaliza seus balões de insight.
- Cada balão apresenta todas as referências pertinentes, autor, obra, página,
  parágrafo e citação literal. Não limitar o número de livros/artigos por fala.
- Correção de texto, papel, contexto ou retirada de consentimento invalida
  imediatamente referências e tracejado antigos.
- Juiz permanece bloqueado até qualificação independente aprovada. Fixture de
  interface não comprova precisão clínica.
- Régua do juiz redefinida pelo usuário em 7 de outubro de 2026: limite inferior
  de Wilson ≥ 0,88 para a precisão dos cartões (cerca de 90% pertinentes) e ao
  menos 70% das fontes pertinentes mostradas, no conjunto geral e nos contrastes
  de fonte; na qualificação, ≥ 70% das falas positivas com referência pertinente.
  Os alvos de risco, ambiguidade, falas neutras e do terapeuta não mudam.
- Unidade de análise: cada frase do paciente, com as frases anteriores dele como
  contexto, e uma passada final sobre a fala inteira quando ela termina.
- Prioridade reiterada pelo usuário: concluir a implementação e a qualificação
  do juiz, corrigindo as reprovações existentes até obter resultados aceitáveis.
  Uma ausência de referência pertinente também deve ser uma decisão por frase;
  não fabricar fontes para evitar silêncio.

## Identidade e privacidade

- Paciente tem identificador opaco. Cada vínculo profissional–paciente usa seu
  próprio identificador de prontuário; um paciente pode ter vários profissionais.
- Nome, contatos e conteúdo clínico ficam cifrados no cliente, acessíveis apenas
  a quem possui as chaves autorizadas. Serviço não recebe identidade em claro.
- Convite/magic link nasce de paciente/prontuário da carteira autenticada;
  não pode ser gerado publicamente só por conhecer um ID. Token aleatório,
  validade, uso único, revogação e vínculo autorizado são obrigatórios.
- Remover solicitação e envio de e-mail do paciente. Não fabricar endereço
  fictício para contornar a estrutura antiga de contas.
- Vínculo entre profissionais não dá acesso automático aos prontuários uns dos
  outros. Histórico é limitado à carteira e ao compartilhamento autorizado.
- Persistir somente transcrição cifrada, tempos, papéis e revisões; jamais áudio
  de sessão, incluindo OPFS, logs, banco, temporários em disco e backup.
- Durante inferência local existe áudio/texto transitório em memória. Isso não
  autoriza retenção nem envio a provedores externos. Testar ausência de persistência.

## Carteira e acervo do profissional

- Organizar a carteira em uma pasta por prontuário opaco, com as sessões e
  revisões correspondentes. Associação de nota a sessão precisa ser explícita;
  não inferir vínculo pela proximidade de datas.
- Permitir guardar materiais próprios PDF/TXT com conteúdo e metadados cifrados
  no cliente. Upload não autoriza automaticamente seu uso em análise clínica.
- Preparar os materiais autorizados no motor local apenas em memória, isolados
  por conta. Revogação ou exclusão invalida resultados e consultas em andamento.
- Insights usam somente o acervo autorizado da conta e mantêm autor, página,
  parágrafo, citação literal e verificação da fonte.

## Conclusão do goal

A V1 só está concluída quando os critérios acima e os fluxos pendentes de
`implementacao-final-limmiar.md` forem comprovados no app local. Registrar
resultados reais separados de testes sintéticos e de funcionalidades planejadas.
