# Cadastro de voz

`VoiceEnrollmentGate` exige cadastro após o desbloqueio do cofre profissional,
antes de montar qualquer página do consultório. O perfil existente precisa abrir
com a chave atual; sem ele, a configuração guiada não oferece pular. Salvar com
confirmação da API libera o destino original; remover o perfil bloqueia novamente.
O gate não guarda marcadores no navegador nem altera o fluxo dos pacientes.
A verificação (`perfil-de-voz`) mostra só um carregamento neutro; a configuração
aparece apenas quando a API confirma que não há perfil. Falha de leitura mantém o
bloqueio com erro e nova tentativa, sem oferecer cadastro sobre um perfil talvez válido.

`VoiceSettings` é a configuração profissional em `/settings/voice`. A rota exige
conta profissional, token e KEK desbloqueada. Permite cadastrar, substituir e
remover o perfil; respostas depois da saída são ignoradas.

`capturar-perfil` prepara o worker TitaNet local, solicita o microfone após
consentimento explícito e captura 15 segundos de PCM somente em memória. As três
linhas são orientação de leitura, não um mínimo de qualidade publicado pela NVIDIA.
Silêncio e inconsistência entre três trechos de 5 segundos recusam a amostra.
O microfone fecha antes da inferência; cancelamento e permissão tardia limpam tudo.

A API e a cifra pertencem a `entities/voz`. A feature recebe o vetor válido,
sela com DEK/KEK, exige confirmação 204 e apaga o vetor aberto. Nunca envia áudio.
O reconhecimento durante a sessão pertence a `live-session/identificar-vozes`.

A prova E2E usa duas vozes sintéticas, conta real com TOTP e Postgres real.
Cadastro → saída → navegador novo → recuperação → reconhecimento automático
passou, sem seleção manual. Isso não comprova a precisão em vozes humanas.
