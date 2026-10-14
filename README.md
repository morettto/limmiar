# Limmiar local

Requisitos: Node.js 22 ou posterior, pnpm 10, .NET SDK 10, Python 3.12/uv e Docker Desktop em execução com contêineres Linux. Os modelos bibliográficos seguem as instruções de `mvp-copiloto/README.md`.

```powershell
pnpm install
uv sync --project mvp-copiloto
pnpm dev
```

Abra [http://localhost:5173](http://localhost:5173). O comando cria um PostgreSQL dedicado, aplica migrações, garante o serviço de transcrição (containers `nemotron-speech-N` e o gateway de fala, `tools/nemotron`), inicia o serviço bibliográfico local e abre API/interface. A primeira subida constrói a imagem do serviço de transcrição (`tools/nemotron/Dockerfile`) e baixa ~710 MB de modelo para um volume Docker; as seguintes usam o cache.

A configuração e as credenciais locais ficam em `.local/settings.json`, ignorado pelo Git. O banco persiste no volume `limmiar-local-postgres`; os modelos de transcrição ficam no volume `nemotron_models`. Ctrl+C encerra API, interface e serviço bibliográfico; os contêineres permanecem disponíveis para o próximo início.

Crie uma conta de profissional e configure TOTP. Envie a referência do documento para revisão. Para aprovar **uma conta fictícia de desenvolvimento**, use:

```powershell
$env:LIMMIAR_API_URL = 'http://127.0.0.1:5259'
$env:LIMMIAR_STAFF_API_KEY = (Get-Content .local/settings.json -Raw | ConvertFrom-Json).StaffAccess.ApiKey
node tools/approve-local.mjs email-da-conta-local
```

Esse comando usa o endpoint administrativo real, restrito ao ambiente local; no ambiente de teste web, a mesma URL e a chave vêm de `docs/ambiente-de-teste.md`. A chave da equipe não é enviada à interface. Depois, clique em **Atualizar verificação**.

O fluxo local disponível permite cadastrar pacientes com conteúdo cifrado, registrar consentimentos, salvar e assinar notas SOAP e carregar/gravar áudio. A análise de áudio exige consentimento. Depois da transcrição, ouça cada voz, confirme o papel de paciente ou profissional e corrija texto e voz por palavra. Qualquer edição invalida a confirmação da revisão. Voz não identificada permanece excluída da transcrição canônica.

O menu **Notas do prontuário** recupera as notas reais da conta. Ao reabrir uma nota assinada, o cliente confere o digest selado contra seu conteúdo canônico antes de bloquear a edição. Os relatórios de cobertura são excluídos do monitoramento do Vite para não recarregar a sessão durante os testes.

Somente a transcrição é salva: texto, tempos, vozes, papéis e revisões, cifrados sob a chave do paciente. O áudio de revisão permanece temporariamente em memória e é descartado; não há persistência de áudio em OPFS, banco ou API.

A transcrição roda no servidor (Nemotron 3.5 ASR Streaming, `tools/nemotron`): o app manda áudio por WebSocket (`/speech`), somente em memória. No presencial, o gateway separa trechos com Pyannote/sherpa-onnx e compara TitaNet com o perfil cadastrado do profissional e com amostras confirmadas da sessão. Cada palavra recebe o falante do próprio trecho; voz incerta aguarda contexto acústico ou revisão manual. A sessão online usa os papéis das trilhas autenticadas. O cadastro do perfil continua no aparelho e cifrado em armazenamento. Decisão e privacidade: `docs/adr/ADR-0012-transcricao-no-servidor.md`.

O copiloto bibliográfico ainda precisa cumprir os critérios de qualidade. O [plano de integração](mvp-copiloto/docs/plano-implementacao-limmiar.md) registra o estado medido, as etapas e os critérios de aceite. O cliente consulta somente falas estáveis identificadas como paciente e recebe fontes progressivamente. A rota de produto permanece bloqueada enquanto não houver qualificação independente verificada; nenhum cartão é incorporado automaticamente ao prontuário.

Verificação:

```powershell
dotnet test apps/api/Api.sln -c Release
pnpm --filter app build
pnpm --filter app lint
pnpm --filter app lint:arch
pnpm --filter app lint:i18n
pnpm --filter app exec vitest run --coverage --maxWorkers=2
pnpm --filter @limmiar/audio test:unit
pnpm --filter @limmiar/diarization test:unit
mvp-copiloto/.venv/Scripts/python.exe mvp-copiloto/scripts/test_confiabilidade.py
```
