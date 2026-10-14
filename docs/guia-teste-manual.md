# Guia de teste manual do Limmiar (ambiente local)

Para o dono do produto, sem precisar programar. Percorre à mão todas as funcionalidades da V1 num PC com Windows, com o ambiente local (`pnpm dev`) e login local (e-mail, senha e segundo fator). Escrito em 9 de outubro de 2026, sobre o branch `codex/copiloto-mvp`. Reserve uma tarde (estimativa, não medida).

Cada comando, rota e texto de botão abaixo foi conferido contra o código (`tools/dev.mjs`, `apps/app/src`, `apps/api`, `mvp-copiloto`). Os textos entre aspas são os da interface em português do Brasil. Nada foi executado para escrever este guia: veja "Limites deste guia" no fim.

## Como usar

- Cada passo tem **Fazer**, **Esperado** e **Resultado**. Marque `☒ ok` ou `☒ falhou` trocando o `☐`. Se falhou, anote na seção 5.
- Faça na ordem: cada parte usa o que a anterior criou (conta, paciente, acervo, voz, sessão salva).
- Etiquetas: **[JUIZ]** só funciona com o juiz (GPU) ligado; **[VOZ]** exige voz humana e microfone; **[2 NAV]** exige dois navegadores; **[PASSKEY]** exige uma chave de acesso (passkey) que suporte PRF; **[CEL]** usa o celular.
- Use só dados fictícios. A fala do paciente vai ao juiz numa GPU fora do Brasil (decisão D3 de `docs/plano-fechamento-v1.md`).
- Sem juiz, os passos **[JUIZ]** ficam como "n/a" e o resto funciona igual.

| Funcionalidade | Seção | Precisa de |
| --- | --- | --- |
| Conta, TOTP, aprovação, frase de recuperação, sair e entrar | 2 | celular com app autenticador |
| Pacientes e prontuário | 3.1 | nada |
| Agenda e painel do dia | 3.2 | nada |
| Notas SOAP e assinatura | 3.3 e 3.9 | nada (3.9 precisa de cartões) |
| Biblioteca de notas | 3.4 | nada |
| Acervo (PDF) | 3.5 | copiloto no ar |
| Cadastro de voz | 3.6 | voz humana |
| Sessão ao vivo (transcrição, identificar vozes) | 3.7 | voz humana, ou arquivo de áudio |
| Cartões forte e possível, votos, interruptor | 3.8 | juiz (GPU) e voz humana |
| Sessão online (WebRTC) | 3.10 | dois navegadores, fones de ouvido |
| Convite e vínculo do paciente | 3.11 | segundo navegador, passkey com PRF |
| Check-in do paciente | 3.12 | idem |
| Partilha e espelho | 3.13 | idem |
| Pareamento de dispositivos | 3.14 | dois navegadores |
| Frase de recuperação (uso) | 3.15 | a frase anotada na seção 2 |
| Trilha de auditoria | 3.16 | nada |
| Sair e entrar de novo | 2 e 3.17 | nada |

---

## 1. Preparar o computador

### 1.1 Programas necessários

| Programa | Como conferir (PowerShell) | Esperado |
| --- | --- | --- |
| Docker Desktop, com contêineres Linux, aberto | `docker info --format "{{.ServerVersion}}"` | um número de versão (se der erro, abra o Docker Desktop e espere "Engine running") |
| Node.js 22 ou mais novo | `node --version` | `v22` ou maior |
| pnpm 10 | `pnpm --version` | `10.x` (se faltar: `corepack enable`) |
| .NET SDK 10 | `dotnet --version` | `10.x` |
| uv (traz o Python 3.12 sozinho) | `uv --version` | uma versão |
| Chrome ou Edge atual | – | – |
| Cliente SSH do Windows (só para o juiz remoto por túnel) | `ssh -V` | `OpenSSH_...` |
| App autenticador no celular (Google Authenticator, Authy, Microsoft Authenticator) | – | – |

### 1.2 Portas usadas

| Porta | Quem usa | Observação |
| --- | --- | --- |
| 5173 | app (Vite) | abra sempre `http://localhost:5173` (não `127.0.0.1`: a passkey e a origem liberada são `localhost`) |
| 5259 | API .NET | |
| 8000 | copiloto Python (uvicorn) | |
| 5432 | PostgreSQL do contêiner `limmiar-local-postgres` | |
| 8100 | túnel SSH para o juiz (só no modo B) | escolhida para não colidir com a 8000 |

O teste automatizado (Playwright) usa 5259, 5432, 5333 e 8787. **Não rode os dois ao mesmo tempo.** Se existir o contêiner `pg-e2e` (confira com `docker ps`) e nenhum teste estiver rodando, apague-o antes: `docker rm -f pg-e2e`.

### 1.3 Instalar (só na primeira vez)

Todos os comandos deste guia partem da pasta do projeto.

```powershell
cd C:\Users\m0retto\Documents\projects\limmiar
pnpm install
uv sync --project mvp-copiloto
```

Opcional, para separar problemas de download de problemas do app (o `pnpm dev` faz o mesmo sozinho):

```powershell
node tools/nemotron/garantir.mjs     # serviço de transcrição (container nemotron-speech-1); termina com "Serviço de transcrição pronto em http://127.0.0.1:8080"
node tools/voice-identity/setup.mjs  # extrator de voz; termina com "Extrator TitaNet local verificado"
```

O serviço de transcrição usa a imagem `limmiar-nemotron:0.2.0-cpu`, construída na primeira subida a partir de `tools/nemotron/Dockerfile`, e baixa ~710 MB de modelo para o volume `nemotron_models`. Nesta máquina, em 10/10/2026, o container já existia e o extrator de voz já estava construído. O modelo de busca bge-m3 já estava no cache do Hugging Face. O `setup.mjs` da voz precisa do Docker na primeira construção.

### 1.4 O juiz (cartões do copiloto)

O app chama o copiloto (porta 8000), que chama o juiz. Três modos. As variáveis valem só na janela do PowerShell em que forem definidas: **defina na mesma janela em que vai rodar `pnpm dev`.**

**Modo A, sem juiz.** O que muda: transcrição, vozes, notas, agenda, tudo igual. **Nenhum cartão aparece.** Durante a sessão, com análise por IA autorizada e fala do paciente, o app mostra "Copiloto não liberado. A transcrição segue normalmente, sem análise das falas." (o copiloto responde 503 sem `COPILOTO_JUIZ_URL`). Os passos [JUIZ] (3.8 e 3.9) ficam "n/a".

```powershell
Remove-Item Env:COPILOTO_JUIZ_URL, Env:COPILOTO_JUIZ_CHAVE, Env:COPILOTO_JUIZ_VERSAO -ErrorAction SilentlyContinue
```

**Modo B, juiz remoto na GPU alugada (Vast), por túnel SSH.** O servidor (vLLM com o adaptador v2) precisa estar rodando na máquina alugada, na porta 8000 dela (a do `tools/juiz/README.md`; se a sua for outra, troque o segundo número do `-L`), com `VLLM_API_KEY` definida. Na tela da Vast, pegue o IP e a porta do SSH direto. Em uma janela do PowerShell, que fica aberta e parece parada (é normal por causa do `-N`):

```powershell
ssh -N -L 8100:127.0.0.1:8000 -p <PORTA_SSH_DA_VAST> root@<IP_DA_VAST>
```

Em outra janela, confira o túnel (esperado: `HTTP/1.1 200 OK`) e que a chave é exigida (esperado: `401`):

```powershell
curl.exe -i http://127.0.0.1:8100/health
curl.exe -i http://127.0.0.1:8100/v1/models
```

Depois defina, na janela do `pnpm dev`:

```powershell
$env:COPILOTO_JUIZ_URL    = 'http://127.0.0.1:8100'
$env:COPILOTO_JUIZ_CHAVE  = 'COLE-AQUI-A-CHAVE-DO-JUIZ'   # a mesma VLLM_API_KEY do servidor
$env:COPILOTO_JUIZ_VERSAO = 'v2'                          # tem de constar como promovida em mvp-copiloto\data\juiz-v2\registro.jsonl
```

Teste de fumaça do juiz (na mesma janela das variáveis). Esperado: uma linha `notas [...] em X.XXs; reescrita: [...]` e nenhum erro:

```powershell
mvp-copiloto\.venv\Scripts\python.exe tools\juiz\smoke.py
```

**Termine sempre destruindo a instância na Vast** (cobra por hora ligada).

**Modo C, juiz com endereço HTTPS (por exemplo o da Fly).** Troque só a URL: `$env:COPILOTO_JUIZ_URL = 'https://limmiar-juiz-teste.fly.dev'`, com a chave e a versão como acima. Esse juiz dorme: a primeira resposta leva alguns minutos. Espere assim:

```powershell
do { Start-Sleep 10 } until ((curl.exe -s -o NUL -w "%{http_code}" "$env:COPILOTO_JUIZ_URL/health") -eq '200')
```

Nenhum juiz foi publicado na Fly até agora (`docs/ambiente-de-teste.md`), então este modo não foi verificado.

### 1.5 Subir tudo

Na mesma janela das variáveis do juiz:

```powershell
cd C:\Users\m0retto\Documents\projects\limmiar
pnpm dev
```

O comando faz, em ordem: abre/cria o PostgreSQL no Docker (`limmiar-local-postgres`) e aplica as migrações; garante o serviço de transcrição (container `nemotron-speech-1`, porta 8080; a primeira subida baixa ~810 MB de modelos); prepara o extrator de voz; inicia o copiloto (8000), a API (5259) e o app (5173). Na primeira vez gera `.local\settings.json` com as senhas locais (fora do Git). A última linha é `Limmiar local: http://localhost:5173 — Ctrl+C encerra API, interface e serviço bibliográfico.` Ela aparece **antes** de a API e o copiloto terminarem de carregar (a API compila e o copiloto carrega modelos): confira com a tabela abaixo. **Não feche essa janela** durante o teste.

### 1.6 Como saber que cada serviço está de pé

| Serviço | Comando | Esperado |
| --- | --- | --- |
| PostgreSQL | `docker ps --filter name=limmiar-local-postgres --format "{{.Names}}: {{.Status}}"` | `limmiar-local-postgres: Up ... (healthy)` |
| API | `curl.exe -i http://127.0.0.1:5259/health/db` | `HTTP/1.1 200 OK` (503 = banco fora) |
| Copiloto | `curl.exe http://127.0.0.1:8000/api/saude` | JSON com `"juiz_llm":{"versao":"...","no_ar":...}`; com juiz bom, `"qualificado":true` e `"no_ar":true`; sem juiz, `"qualificado":false` (modo A: normal) |
| App | abra `http://localhost:5173` | "Bem-vindo ao Limmiar" |
| Ligação app → API | `curl.exe -i http://localhost:5173/health` | `HTTP/1.1 200 OK` |
| Ligação app → copiloto | `curl.exe http://localhost:5173/copiloto/api/saude` | o mesmo JSON do copiloto |
| Serviço de transcrição | `curl.exe http://127.0.0.1:8080/ready` | JSON com `"ready":true` e `"capabilities":["asr","diarization"]` |
| Ligação app → transcrição | `curl.exe http://localhost:5173/speech/ready` | o mesmo JSON do serviço |

### 1.7 Navegador e materiais

- Navegador principal: Chrome ou Edge (o app abre sempre em **Português**, qualquer que seja o idioma do navegador; o seletor "Idioma", no canto superior direito de toda tela, troca para English, Español ou Italiano e a escolha fica salva no aparelho). Outro navegador, ou perfil convidado, para o "paciente" e o "segundo dispositivo".
- Microfone funcionando e fones de ouvido (para a sessão online).
- 2 ou 3 PDFs seus de psicologia, com texto selecionável (não escaneados), até 20 MB cada. Texto `.txt` em UTF-8 também serve.
- Um bloco de notas aberto para anotar: senha, 10 códigos de backup, 24 palavras da frase, ID do paciente, links.
- As seis frases do Anexo A, em outra tela ou no papel.
- Opcional: um arquivo de áudio (até 64 MB) com duas vozes lendo as frases do Anexo A. Serve para repetir a sessão sem precisar de duas pessoas.

### 1.8 Parar e recomeçar do zero

- Parar: `Ctrl+C` na janela do `pnpm dev`. O contêiner continua; para liberar memória: `docker stop limmiar-local-postgres`.
- Reiniciar a API derruba todas as sessões e as salas online, e reiniciar o copiloto apaga o acervo "preparado" (o cifrado continua guardado).
- Recomeçar com banco vazio (apaga todas as contas de teste): pare o `pnpm dev`, depois `docker rm -f limmiar-local-postgres` e `docker volume rm limmiar-local-postgres`, e rode `pnpm dev` de novo. Use uma aba nova no navegador.

---

## 2. Conta do profissional e login local

Endereço: `http://localhost:5173`. Anote tudo no bloco de notas.

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| C1 | Abra o endereço. | "Bem-vindo ao Limmiar" e "Seu consultório, com privacidade.". Formulário com "E-mail" e "Senha" e o botão "Criar conta". | ☐ ok ☐ falhou |
| C2 | E-mail `profissional.teste@example.com`; Senha: uma frase longa (anote). Clique em "Criar conta". A senha é o que protege os dados: sem ela **e** sem a frase de recuperação, os prontuários não abrem. | Alguns segundos de espera, depois "Configure a verificação em duas etapas", com "Código secreto" e "Link de provisionamento". | ☐ ok ☐ falhou |
| C3 **[CEL]** | No app autenticador: adicionar conta digitando a chave à mão (nos apps costuma ser "Inserir chave de configuração"), nome "Limmiar", chave = o "Código secreto" da tela, tipo baseado em tempo. Digite os 6 números em "Código de 6 dígitos do aplicativo autenticador" e clique em "Confirmar". | "Guarde seus códigos de backup" com 10 códigos. Se recusar, espere o número mudar (a cada 30 s). O relógio do PC e do celular têm de estar certos. | ☐ ok ☐ falhou |
| C4 | Copie os 10 códigos e clique em "Guardei meus códigos". | Tela "Limmiar" com o cartão "Verificação profissional" e "Envie a referência do documento profissional para revisão.". | ☐ ok ☐ falhou |
| C5 | Em "Referência do documento" escreva `CRP 00/00000 (fictício)` e clique em "Enviar para revisão". | "Documento recebido. Sua conta aguarda a aprovação da equipe." | ☐ ok ☐ falhou |
| C6 | Numa segunda janela do PowerShell, na pasta do projeto, rode o bloco abaixo (troque o e-mail pelo seu). | No terminal: "Conta aprovada. Clique em Atualizar verificação na interface." | ☐ ok ☐ falhou |
| C7 | No navegador, clique em "Atualizar verificação". | Aparecem "Seu dia no consultório" e "Pacientes e prontuário". No topo, os links: "Notas do prontuário", "Biblioteca de notas", "Acervo pessoal", "Sinais compartilhados pelos pacientes", "Votos do copiloto de IA", "Identificação da sua voz", "Trilha de auditoria", "Frase de recuperação", "Parear novo dispositivo" e o botão "Sair". | ☐ ok ☐ falhou |
| C8 | Link "Frase de recuperação". Em "Senha atual" digite a senha e clique em "Gerar frase de recuperação". | "Guarde sua frase de recuperação" com 24 palavras numeradas. Copie **na ordem**. | ☐ ok ☐ falhou |
| C9 | Clique em "Guardei minha frase". | "Frase de recuperação salva." e o link "Voltar ao consultório". | ☐ ok ☐ falhou |
| C10 | Volte ao consultório e clique em "Sair". | Volta para "Bem-vindo ao Limmiar". | ☐ ok ☐ falhou |
| C11 | Clique em "Entrar" (o botão de cima, ao lado de "Cadastrar"), preencha e-mail e senha e clique em "Acessar conta". | "Verificação em duas etapas" com "Código de verificação". | ☐ ok ☐ falhou |
| C12 | Digite `000000` e clique em "Verificar". | "Código inválido. Verifique o app autenticador ou use um código de backup." | ☐ ok ☐ falhou |
| C13 | Digite o código atual do app e clique em "Verificar". | Entra no consultório; o e-mail aparece no topo. | ☐ ok ☐ falhou |
| C14 | Aperte F5. | Volta para "Bem-vindo ao Limmiar" (a chave dos prontuários vive só na memória da aba), com o link "Desbloquear pelo outro dispositivo" (usado em 3.14). Entre de novo como em C11 a C13. | ☐ ok ☐ falhou |
| C15 | Clique em "Sair" e entre usando **um dos 10 códigos de backup** no lugar do código do app. | Entra. | ☐ ok ☐ falhou |
| C16 | "Sair" e tente entrar com **o mesmo** código de backup. | "Código inválido. Verifique o app autenticador ou use um código de backup." (cada código vale uma vez). Depois entre com o código do app. | ☐ ok ☐ falhou |
| C17 | "Sair". Em "Entrar", use a senha errada. | "E-mail ou senha inválidos." | ☐ ok ☐ falhou |
| C18 | Na mesma tela, clique em "Cadastrar" e "Criar conta" com o mesmo e-mail. | "Este e-mail já está cadastrado." (engano comum: esquecer de clicar em "Entrar" antes). Depois volte e entre normalmente. | ☐ ok ☐ falhou |

Bloco do passo C6 (a chave da equipe sai de `.local\settings.json`; ela nunca vai à interface):

```powershell
cd C:\Users\m0retto\Documents\projects\limmiar
$env:LIMMIAR_API_URL = 'http://127.0.0.1:5259'
$env:LIMMIAR_STAFF_API_KEY = (Get-Content .local/settings.json -Raw | ConvertFrom-Json).StaffAccess.ApiKey
node tools/approve-local.mjs profissional.teste@example.com
```

Se aparecer "Conta ausente na fila. Envie o documento pela interface primeiro.", faltou o passo C5.

**Limite de tentativas:** a API aceita 5 códigos de segundo fator por minuto por conta e 30 chamadas de `/auth/*` por minuto por IP. Errar demais dá "Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo."

---

## 3. Roteiro por funcionalidade

Entre como profissional (seção 2) e use sempre a mesma aba do navegador principal. Não aperte F5 no meio: a chave só vive na memória da aba e você terá de entrar de novo.

### 3.1 Pacientes e prontuário

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| P1 | Na área "Pacientes" clique em "Adicionar paciente" (abre o formulário). "Nome do paciente" = `Paciente Fictício Um`; "Risco avaliado pelo profissional" = "Baixo"; clique no botão "Adicionar paciente" de dentro do formulário. | A pasta "Paciente Fictício Um" aparece na lista; o contador mostra "1 pasta". | ☐ ok ☐ falhou |
| P2 | Adicione `Paciente Fictício Dois` com risco "Elevado". | "2 pastas". No painel, em "Requer você", aparece "Paciente Fictício Dois · Revisar risco" (e linhas "· Revisar consentimento" enquanto os consentimentos estiverem pendentes). | ☐ ok ☐ falhou |
| P3 | Em "Buscar paciente nesta carteira" digite `Dois`; depois `xyz`; depois apague. | Só a pasta "Dois"; depois "Nenhum paciente corresponde à busca."; depois as duas. | ☐ ok ☐ falhou |
| P4 | Clique na pasta "Paciente Fictício Um". | Cabeçalho "Pasta do paciente" com o nome; "Sessões do paciente" (0 sessões, "As transcrições salvas aparecerão aqui, uma pasta para cada sessão."); "Nota da sessão" com o editor. O foco vai para o nome. | ☐ ok ☐ falhou |
| P5 | Abra "Acesso e consentimentos". Marque "Paciente autorizou a gravação" e "Paciente autorizou a análise por IA local". | As duas caixas ficam marcadas; as linhas "Revisar consentimento" desse paciente somem do painel. Troque de paciente e volte: continuam marcadas. | ☐ ok ☐ falhou |
| P6 | Desmarque e marque de novo uma delas. | Muda sem erro (cada mudança é um registro de consentimento). Deixe as duas **marcadas** para o Paciente Um. | ☐ ok ☐ falhou |

### 3.2 Agenda e painel do dia

Com o Paciente Um aberto.

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| A1 | Veja "Agenda deste paciente". | "Nenhuma sessão agendada nesta semana." | ☐ ok ☐ falhou |
| A2 | "Data e horário": **amanhã às 10:00**. "Duração em minutos": 50. Clique em "Agendar sessão". | "Sessão agendada." e na lista "data e hora · 50 minutos". | ☐ ok ☐ falhou |
| A3 | Agende de novo no **mesmo horário exato**. | "Já existe uma sessão neste horário." (só o horário idêntico conflita). | ☐ ok ☐ falhou |
| A4 | Na sessão, "Remarcar sessão"; o título vira "Novo horário da sessão". Escolha amanhã às 11:00 e clique em "Salvar novo horário". | "Sessão remarcada." e a lista mostra o novo horário. | ☐ ok ☐ falhou |
| A5 | Agende outra para depois de amanhã e clique em "Cancelar sessão" nela. | "Sessão cancelada." e ela some da lista. | ☐ ok ☐ falhou |
| A6 | Mude "Semana a partir de" para daqui a 8 dias e clique em "Atualizar agenda". Volte para hoje. | Primeiro "Nenhuma sessão agendada nesta semana."; depois a sessão volta. | ☐ ok ☐ falhou |
| A7 | No painel "Seu dia no consultório": veja "Hoje", "Próximos dias" e "Indicadores". | "Hoje": "Nenhum encontro por começar hoje."; "Próximos dias": "Paciente Fictício Um" com a data e a hora. "Pacientes ativos" = 2; "Sessões na semana" = 1 (as que ainda não começaram, nos próximos 7 dias). O botão grande mostra "▶ Iniciar próxima: Paciente Fictício Um HH:MM". | ☐ ok ☐ falhou |

### 3.3 Notas SOAP e assinatura

Com o Paciente Um aberto, em "Nota da sessão". O editor tem quatro caixas: "Subjetivo", "Objetivo", "Avaliação" e "Plano". (A "Fila de assinatura" existe no código mas não está ligada às telas do produto; não há o que testar nela.)

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| N1 | Em "Associar nota a uma sessão" deixe "Nota independente". Em "Subjetivo" escreva `Relata sono ruim (texto fictício).` e clique em "Salvar nota". | "Nota salva no prontuário." Em "Histórico do prontuário (1)": "Nota 1 — Pendente" com o texto. No painel, "Paciente Fictício Um · Assinar nota pendente". | ☐ ok ☐ falhou |
| N2 | Escreva também em "Avaliação" e "Salvar nota" de novo. | Continua "Histórico do prontuário (1)" (a mesma nota, nova revisão), com os dois textos. | ☐ ok ☐ falhou |
| N3 | Clique em "Assinar nota" (ou Ctrl+Enter dentro de uma caixa). | "Nota assinada e salva no prontuário." As caixas ficam só leitura; "Salvar nota" e "Assinar nota" ficam desabilitados; o histórico mostra "Nota 1 — Assinada"; o item "Assinar nota pendente" sai do painel. | ☐ ok ☐ falhou |
| N4 | Clique em "Nova nota", escreva `Segunda nota` em "Subjetivo" e "Salvar nota". | "Histórico do prontuário (2)". | ☐ ok ☐ falhou |
| N5 | No histórico, "Abrir nota" na Nota 1. | Abre assinada e só leitura. Nunca deve aparecer "A assinatura não corresponde ao conteúdo da nota." | ☐ ok ☐ falhou |
| N6 | Menu "Notas do prontuário". | Página "Notas do prontuário" com a mesma carteira; abra o Paciente Um e uma nota. | ☐ ok ☐ falhou |

### 3.4 Biblioteca de notas

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| B1 | Menu "Biblioteca de notas". | "Carregando notas do prontuário...", depois uma lista por paciente (nome como título) com "Nota 1", "Assinada — Revisão N" ou "Rascunho — Revisão N" e os textos S/O/A/P. | ☐ ok ☐ falhou |
| B2 | Em "Buscar notas" digite uma palavra que está só numa nota (por exemplo `sono`, ou `Segunda`). | "Preparando a busca..." por instantes; depois só a nota com a palavra. | ☐ ok ☐ falhou |
| B3 | Digite um texto sem sentido. | "Nenhuma nota encontrada." Ao apagar, todas voltam. | ☐ ok ☐ falhou |

### 3.5 Acervo (PDF)

Precisa do copiloto no ar (porta 8000).

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| V1 | Menu "Acervo pessoal". | "Seu acervo" e "Uma estante para suas referências" (vazio). | ☐ ok ☐ falhou |
| V2 | Em "Adicionar material": "Título da obra", "Autores", (opcional) "Referência bibliográfica ou edição" e "Arquivo do material" (seu PDF). Clique em "Guardar no acervo". | "Verificando e cifrando o material...", "Enviando o material cifrado...", depois "Material guardado no seu acervo. Autorize seu uso para prepará-lo nesta máquina." O cartão mostra "Guardado · uso não autorizado". | ☐ ok ☐ falhou |
| V3 | Marque "Autorizar nas minhas consultas". | "Preparando o material na sua máquina..." (de 15 s a 3 min por PDF, medido em CPU no README do copiloto), depois "Material preparado nesta máquina para suas consultas." e "Preparado nesta máquina". | ☐ ok ☐ falhou |
| V4 | Repita V2 e V3 com um segundo e um terceiro material. | "3 materiais". | ☐ ok ☐ falhou |
| V5 | "Buscar no acervo": parte de um título; depois um texto sem sentido. | Filtra; depois "Nenhum material corresponde à busca." | ☐ ok ☐ falhou |
| V6 | Clique em "Recuperar arquivo" num material. | Baixa o arquivo original (confira que abre igual); "Arquivo recuperado e decifrado neste dispositivo." | ☐ ok ☐ falhou |
| V7 | Desmarque "Autorizar nas minhas consultas" e marque de novo. | "Autorização retirada. Este material não participa das suas consultas." e "Guardado · uso não autorizado"; ao marcar, prepara de novo. | ☐ ok ☐ falhou |
| V8 | Tente guardar uma imagem renomeada para `.pdf`. | "Escolha um PDF válido ou texto UTF-8, com até 20 MB." | ☐ ok ☐ falhou |
| V9 | No terceiro material: "Excluir material", depois "Confirmar exclusão". | "Excluir permanentemente este material?" e depois "Material excluído do seu acervo." Mantenha 2 materiais autorizados e preparados. | ☐ ok ☐ falhou |
| V10 | (Opcional) Pare o `pnpm dev` e suba de novo; volte ao acervo. | Os materiais continuam guardados, mas "Autorizado · requer preparação nesta máquina" com o botão "Preparar nesta máquina" (o acervo preparado vive na memória do copiloto). Ao abrir uma sessão (3.7) eles são preparados sozinhos. | ☐ ok ☐ falhou |

### 3.6 Cadastro de voz **[VOZ]**

Fale sozinho, em lugar silencioso.

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| Z1 | Menu "Identificação da sua voz". | "Seu perfil de voz", as três linhas de leitura e "Você ainda não tem um perfil de voz." | ☐ ok ☐ falhou |
| Z2 | Sem marcar nada, olhe o botão "Cadastrar minha voz". | Desabilitado até marcar "Autorizo o uso do microfone para cadastrar minha voz." | ☐ ok ☐ falhou |
| Z3 | Marque a autorização, clique em "Cadastrar minha voz", permita o microfone e leia durante 15 segundos: "Minha voz ajuda a organizar a conversa, respeitando o tempo de cada pessoa." / "Durante a sessão, escuto com atenção e faço perguntas para compreender melhor." / "Este é meu cadastro de voz. As falas do paciente devem permanecer separadas das minhas." | "Preparando o reconhecimento local. Depois, permita o microfone e leia as três linhas.", "Amostra: N de 15 segundos.", "Cifrando seu perfil de voz...", "Perfil de voz salvo. Ele será usado nas próximas sessões." e "Você já tem um perfil de voz." Os botões viram "Substituir perfil de voz" e "Remover perfil de voz". | ☐ ok ☐ falhou |
| Z4 | Clique em "Substituir perfil de voz" e em seguida "Cancelar". | "Cadastro cancelado." | ☐ ok ☐ falhou |
| Z5 | "Substituir perfil de voz" e fique em silêncio, ou fale junto com outra pessoa. | Esperado pelo critério da V1: recusa, com "Não foi possível cadastrar sua voz. Permita o microfone e fale sozinho durante toda a amostra." Se aceitar, anote como achado. | ☐ ok ☐ falhou |
| Z6 | "Remover perfil de voz". | "Perfil de voz removido." e "Você ainda não tem um perfil de voz." Cadastre de novo como em Z3. | ☐ ok ☐ falhou |

### 3.7 Sessão ao vivo: transcrição e identificação de falantes **[VOZ]**

Antes: Paciente Um com as duas autorizações marcadas (P5), 2 materiais autorizados e preparados (V9) e voz cadastrada (Z6). Para duas vozes sem outra pessoa, use um segundo aparelho tocando o Anexo A, ou o arquivo de áudio (S11).

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| S0 | Agende agora uma sessão de **hoje, daqui a 5 minutos**, para o Paciente Um (como em A2). | No painel, "Hoje" lista o Paciente Um e o botão grande passa a apontar para essa sessão (só sessões futuras contam como "próxima"). | ☐ ok ☐ falhou |
| S1 | No painel, clique em "▶ Iniciar próxima: Paciente Fictício Um ...". | O paciente abre e o foco vai para "Tipo de sessão" (deixe "Presencial, com microfone compartilhado"). | ☐ ok ☐ falhou |
| S2 | Veja a área "Gravação e transcrição". | O texto "Seu perfil de voz identifica o profissional. Confira as falas incertas antes de usar a transcrição." Pode aparecer "Preparando seu acervo autorizado para o copiloto local..." e deve sumir. | ☐ ok ☐ falhou |
| S3 | Clique em "Iniciar gravação" e permita o microfone. | "Transcrição ao vivo. Identifique as vozes para analisar somente o paciente.", o botão vira "Encerrar gravação", aparece "Pausar sessão" e "O áudio permanece somente em memória durante a sessão." As primeiras palavras aparecem em cerca de 1 a 2 s: a transcrição roda no serviço da porta 8080, que recebe o áudio só em memória. | ☐ ok ☐ falhou |
| S4 | Fale como profissional: `Bom dia, como foi a sua semana?` Peça à segunda voz a primeira frase do Anexo A (a clínica), com pausa de 2 s. Com o juiz ligado, aproveite esta mesma gravação para a seção 3.8. | Em "Transcrição ao vivo" ("Palavra por palavra") cada linha tem o tempo (`12.3s`) e o papel: "Profissional", "Paciente" ou "Não identificado". | ☐ ok ☐ falhou |
| S5 | Veja "Identificar vozes" (Voz 1, Voz 2). | Sua voz entra como "Profissional" sozinha (pelo perfil cadastrado). A outra, "Paciente" (só se houver exatamente duas vozes). Se não, ajuste nos seletores. | ☐ ok ☐ falhou |
| S6 | "Pausar sessão", fale uma frase, depois "Retomar sessão". | Pausado: "Microfone pausado." e nenhuma palavra nova. Retomado: voltam as palavras. | ☐ ok ☐ falhou |
| S7 | "Encerrar gravação". | "Transcrição concluída. Confirme os papéis das vozes." aparece um player de áudio; "Ouvir esta voz" toca um trecho de cada voz. | ☐ ok ☐ falhou |
| S8 | Abra "Corrigir texto e voz por palavra". Corrija uma palavra em "Texto aos X.Xs". Marque "Conferi o texto e quem falou cada trecho ouvindo o áudio." e clique em "Salvar transcrição". Se o botão não habilitar: alguma voz está "Não identificado" ou alguma palavra ficou sem voz em "Voz aos X.Xs". | "Transcrição revisada." e depois "Transcrição salva no prontuário. Somente texto, tempos e identificação das falas foram armazenados." Na pasta do paciente, "Sessões do paciente": "Sessão 1", "1 revisão". | ☐ ok ☐ falhou |
| S9 | Corrija outra palavra, marque a conferência e salve de novo. | "2 revisões"; em "Revisões e correções" aparece "Revisão 2" e "Profissional responsável: <código>". | ☐ ok ☐ falhou |
| S10 | Corrija uma palavra e clique em "Descartar alterações". | Volta ao último texto salvo. | ☐ ok ☐ falhou |
| S11 | Com a gravação parada, use "Ou carregar áudio" com seu arquivo de duas vozes. | "Transcrevendo e separando as vozes...", depois "Transcrição concluída. Confirme os papéis das vozes." Aqui os papéis são escolhidos à mão em "Identificar vozes". Arquivo que não é áudio: "Escolha um arquivo de áudio válido."; acima de 64 MB: "O áudio deve ter até 64 MB." | ☐ ok ☐ falhou |
| S15 | **Queda do serviço (roteiro, ainda não executado).** Com a gravação em andamento e falando, em outro terminal rode `docker restart nemotron-speech-1`. | Aparece "A conexão com a transcrição caiu. Reconectando: o que for dito agora será transcrito assim que ela voltar."; em até ~15 s o aviso some e as palavras voltam. O texto já transcrito fica; os tempos seguem o relógio da gravação (não voltam a 0 s). Depois da queda o serviço numera as vozes de novo: elas entram como "Voz 3", "Voz 4" e é preciso corrigir os papéis à mão. Se o serviço não voltar a tempo: "A conexão com a transcrição foi perdida." e a gravação encerra com o texto recuperado. | ☐ ok ☐ falhou |
| S16 | **Atraso.** Durante uma gravação de 2 a 3 minutos com as duas vozes falando, observe a tela. | Cada frase aparece finalizada cerca de 1 s depois da pausa, sem acumular atraso. Se aparecer "A transcrição está atrasada em relação à fala. O áudio continua sendo enviado.", anote: a máquina está sobrecarregada (veja `tools/nemotron/README.md`). | ☐ ok ☐ falhou |
| S12 | Desmarque "Paciente autorizou a gravação" (em "Acesso e consentimentos") e olhe a sessão. Marque de novo. | "O consentimento de gravação é necessário." e "Iniciar gravação" desabilitado. | ☐ ok ☐ falhou |
| S13 | Bloqueie o microfone do site no navegador (ícone do cadeado) e clique em "Iniciar gravação". Libere depois. | "Autorize a gravação e permita o microfone." | ☐ ok ☐ falhou |
| S14 | Durante uma gravação ou com mudanças não salvas, olhe o botão "Sair" e tente fechar a aba. | "Sair" desabilitado com "Aguarde o processamento da sessão antes de sair."; o navegador pergunta antes de fechar a aba. | ☐ ok ☐ falhou |

**Só com voz humana se mede:** se o reconhecimento acerta as palavras e se separa as duas vozes de verdade (o único dado de erro de palavras é de voz sintética: 38% no motor antigo do navegador, `docs/spikes/asr-navegador.md`; o do servidor ainda não tem WER medido). Anote erros de palavra e trocas de voz.

### 3.8 Cartões do copiloto, votos e interruptor de consentimento **[JUIZ] [VOZ]**

Faça **durante a gravação do 3.7** (entre S3 e S6), com o juiz ligado (modo B ou C da seção 1.4), e só depois encerre e salve a transcrição (S7 e S8). Fale, como paciente, as frases do Anexo A, uma de cada vez, com pausa de 2 s. Cronometre da última palavra dita até o cartão aparecer.

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| K0 | **Modo A (sem juiz):** fale a frase clínica. | "Copiloto não liberado. A transcrição segue normalmente, sem análise das falas." e nenhum cartão. Os demais passos desta seção ficam "n/a". | ☐ ok ☐ falhou |
| K1 | Fale as seis frases do Anexo A. | Resultado de cada uma conforme a coluna "Esperado" do Anexo A. Em "Insights durante a sessão", antes do primeiro cartão: "Quando houver um insight, a fala será marcada com tracejado." Anote o tempo até o primeiro cartão. | ☐ ok ☐ falhou |
| K2 | Na frase clínica, aperte Tab até a fala sublinhada e Enter (ou clique). | A fala tem **sublinhado tracejado**. Abre "Fontes pertinentes (N)" com a frase, e em cada cartão: "título — autor", "Página X, parágrafo Y" e a citação literal. O foco vai para o balão. | ☐ ok ☐ falhou |
| K3 | Abra "Possíveis: confira antes de usar (M)". | Fechado por padrão; ao abrir, os cartões de nota entre 0,7 e 0,9. Fortes (nota de 0,9 para cima) ficam acima, sempre abertos. Uma fala **só com possíveis** tem sublinhado **pontilhado** e mais claro. | ☐ ok ☐ falhou |
| K4 | Clique em "Voltar à fala". | O foco volta para a fala. | ☐ ok ☐ falhou |
| K5 | Na frase de risco ("Às vezes penso que seria melhor não acordar."). | "Avalie esta fala no contexto do atendimento." (ou "Esclareça o contexto desta fala com o paciente.", se a fala for ambígua). | ☐ ok ☐ falhou |
| K6 | Em um cartão clique em "Útil". | Aparece a pergunta "Enviar seus votos, sem identificação, para melhorar as sugestões?" com "Enviar" e "Só neste aparelho". Escolha **"Só neste aparelho"**. O botão "Útil" fica marcado. | ☐ ok ☐ falhou |
| K7 | Vote "Útil" ou "Não útil" em pelo menos 5 cartões. | Cada botão fica marcado (pressionado) e a pergunta não volta. | ☐ ok ☐ falhou |
| K8 | Confira que nada foi enviado: `Test-Path mvp-copiloto\data\votos\votos.jsonl` | `False` (o arquivo só nasce com votos enviados). | ☐ ok ☐ falhou |
| K9 | Encerre e salve a transcrição (S7 e S8; durante a gravação os links do topo somem). Menu "Votos do copiloto de IA". | Página com "Os votos “útil” e “não útil” ficam cifrados neste aparelho. Eles só são enviados se você ligar a opção abaixo." e o interruptor "Enviar meus votos de útil / não útil, sem identificação, para melhorar as sugestões", **desligado**. | ☐ ok ☐ falhou |
| K10 | Ligue o interruptor. Volte ao consultório, abra o Paciente Um, "Sessões do paciente", "Sessão 1" e "Revisar esta sessão". Vote em mais um cartão. Rode `Get-Content mvp-copiloto\data\votos\votos.jsonl`. | Os cartões voltam (o juiz é consultado de novo) e os votos de K7 aparecem marcados. O arquivo existe e tem uma linha para o voto novo. **A fala do paciente fica em claro nesse arquivo** (achado conhecido do plano): por isso só frases fictícias. | ☐ ok ☐ falhou |
| K11 | Desligue o interruptor (menu "Votos do copiloto de IA"), reabra a sessão como em K10 e vote de novo. | Nenhuma linha nova no arquivo. | ☐ ok ☐ falhou |
| K12 | Diga a frase clínica **como profissional** (sua voz). | Nenhum cartão: fala do profissional nunca é analisada. | ☐ ok ☐ falhou |

**Só com o juiz se mede:** quais cartões aparecem, se os fortes e possíveis fazem sentido e o tempo até o primeiro cartão (medido antes em 2,6 s de mediana com uma fala por vez, `docs/plano-fechamento-v1.md` §2; é o dado a comparar). A tela só tem "Útil" e "Não útil": anote à mão a obra e a página dos cartões que pareceram errados.

### 3.9 Referência na nota (continuação de 3.7 e 3.8) **[JUIZ]**

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| R1 | Antes de salvar a transcrição, veja um balão com cartões. | "Salve a revisão da transcrição para usar uma referência na nota." e "Escolher referência para a nota" desabilitado. | ☐ ok ☐ falhou |
| R2 | Encerre a gravação, confira e salve a transcrição (S7 e S8). Num cartão clique em "Escolher referência para a nota". | Na carteira surge o formulário "Referência para aprovação": "Revisar referência antes de incluir", com a fala, "autor · título" e a citação. | ☐ ok ☐ falhou |
| R3 | Clique em "Confirmar referência na avaliação". | "Referência incluída no rascunho. Confira a avaliação antes de salvar ou assinar." A nota fica associada à sessão (campo "Associar nota a uma sessão" = "Sessão N") e, em "Avaliação", surge uma linha recolhível "Referência bibliográfica · título". | ☐ ok ☐ falhou |
| R4 | Escreva em "Subjetivo" e em "Avaliação 2" e clique em "Assinar nota". | "Nota assinada e salva no prontuário." | ☐ ok ☐ falhou |
| R5 | Noutro cartão, "Escolher referência para a nota" e depois "Descartar referência". | O formulário some e a nota não muda. | ☐ ok ☐ falhou |
| R6 | "Sair" e entre de novo (seção 2, C11 a C13). Abra o Paciente Um, "Histórico do prontuário", "Abrir nota". Abra "Referência bibliográfica" e clique em "Ver fala da referência". | A nota abre só leitura, com autor, "Página X, parágrafo Y" e a citação. A transcrição reabre ("Transcrição recuperada do prontuário. O áudio não é armazenado.") com a mesma palavra corrigida. | ☐ ok ☐ falhou |

### 3.10 Sessão online (WebRTC) **[2 NAV] [VOZ]**

Use fones de ouvido nos dois navegadores (sem eles, um escuta o outro e dá eco). Os dois navegadores no mesmo PC podem compartilhar o microfone; se puder, use um microfone diferente em cada. Outra rede exige um servidor TURN, que não existe no ambiente local (não testável aqui).

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| O1 | No principal, abra o Paciente Um. Em "Tipo de sessão" escolha "Online, com conexão do paciente". | Aparece o botão "Gerar convite de sessão online". | ☐ ok ☐ falhou |
| O2 | Clique nele. | "Link privado da sessão online" (campo) com `http://localhost:5173/session/online#room=...&token=...`, "Entregue este link diretamente ao paciente. Nome e contato não são solicitados.", a caixa "Sessão online" e o botão "Encerrar e revogar convite online". | ☐ ok ☐ falhou |
| O3 | No segundo navegador, cole o link. Antes, teste só `http://localhost:5173/session/online`. | Sem os dados: "Convite inválido. Solicite um novo link ao profissional." Com o link: página "Sessão online". | ☐ ok ☐ falhou |
| O4 | No principal: marque "Autorizo o uso do microfone e a transcrição nesta sessão online. O áudio segue ao servidor de transcrição, só em memória, e não é gravado." e "Entrar na sessão online"; permita o microfone. | "Aguardando o outro participante." | ☐ ok ☐ falhou |
| O5 | No segundo: marque a autorização, "Entrar na sessão online", permita o microfone. | "Sessão online conectada." nos dois. | ☐ ok ☐ falhou |
| O6 | Fale nos dois sentidos. | Cada lado ouve o outro (player "Áudio do outro participante"). | ☐ ok ☐ falhou |
| O7 | No principal, olhe a transcrição. | "Transcrição online ao vivo. Cada trilha identifica quem está falando." Palavras do seu microfone como "Profissional"; do outro, como "Paciente". Não aparece "Identificar vozes". | ☐ ok ☐ falhou |
| O8 | No segundo, "Desligar meu microfone". Fale. Depois "Ligar meu microfone". | "Seu microfone está desligado." sem palavras novas do paciente; depois volta. | ☐ ok ☐ falhou |
| O9 | Feche a aba do segundo navegador e reabra o mesmo link; entre de novo. | O principal mostra "Conexão interrompida. Tente reconectar." e, quando o paciente reentra, volta a "Sessão online conectada." (se não voltar sozinho, "Reconectar sessão online"). | ☐ ok ☐ falhou |
| O10 | No segundo, bloqueie o microfone do site e clique em "Entrar na sessão online". Depois libere e clique em "Reconectar sessão online". | Com bloqueio: "Não foi possível conectar. Confira o convite, permita o microfone e tente novamente." e "Conexão interrompida. Tente reconectar." Depois conecta. Nenhum áudio é salvo. | ☐ ok ☐ falhou |
| O11 | No principal, confira o texto e salve (marque "Conferi o texto e quem falou cada trecho." e "Salvar transcrição"). | "Transcrição salva no prontuário. ..." | ☐ ok ☐ falhou |
| O12 | **[JUIZ]** Com o juiz ligado, fale uma frase clínica no segundo navegador. | Só a trilha do paciente é analisada: cartão como em 3.8. | ☐ ok ☐ falhou |
| O13 | Clique em "Encerrar e revogar convite online". Tente reentrar com o mesmo link no segundo. | Principal: "Convite online encerrado." Segundo: "Sessão online encerrada."; reentrar dá "Não foi possível conectar. Confira o convite, permita o microfone e tente novamente." | ☐ ok ☐ falhou |

### 3.11 Convite e vínculo do paciente **[2 NAV] [PASSKEY]**

O paciente não tem e-mail nem senha: entra por link e confirma com uma passkey, que também gera a chave dos dados dele (exige a extensão PRF). Use o **segundo navegador**, no endereço `http://localhost:5173`.

Se a passkey do seu Windows não suportar PRF o app avisa "Esta chave de acesso não permite desbloquear seus dados cifrados. Escolha outra chave de acesso." Alternativas, **não verificadas aqui**: uma chave de segurança FIDO2 USB, ou a passkey do celular (Chrome: "Usar um telefone ou tablet"); ou, no Chrome, DevTools (F12) > ⋮ > Mais ferramentas > WebAuthn > criar um autenticador virtual (ctap2, interno, chave residente, verificação de usuário, e a opção de PRF se existir), mantendo o DevTools aberto durante todo o teste. Se nada servir, as seções 3.11 a 3.13 não podem ser feitas à mão: peça ao assistente para rodar os testes automáticos `magic-link-login.spec.ts`, `vinculo-chave-publica.spec.ts`, `checkin-diario.spec.ts` e `partilha-checkin.spec.ts` (usam autenticador virtual).

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| I1 | No principal, abra o Paciente Um, "Acesso e consentimentos" e clique em "Gerar link privado de acesso". | Campo "Link de acesso do paciente" com `http://localhost:5173/auth/magic-link?token=XXXXXXXXXXXX`, "Entregue este link diretamente ao paciente. Ele confirma o acesso com sua passkey." e "Válido até" (7 dias). | ☐ ok ☐ falhou |
| I2 | **Antes de o paciente entrar**, no principal abra "Sinais compartilhados pelos pacientes" uma vez e volte. | "Nenhum check-in compartilhado." Isso publica a chave pública da profissional, sem a qual o paciente não consegue compartilhar (3.13). | ☐ ok ☐ falhou |
| I3 | No segundo navegador, cole o link. | Título "Limmiar" e o cartão "Acesso privado do paciente": "Confirme com sua chave de acesso. Seu nome e contato não serão solicitados.", o campo "Já tem um ID no Limmiar? Informe para usar a mesma conta." (deixe vazio) e "Confirmar meu acesso". | ☐ ok ☐ falhou |
| I4 | Clique em "Confirmar meu acesso" e aprove a passkey. | "Login realizado com sucesso.", "Seu ID no Limmiar: <código>" (anote) e o link "Abrir meu acompanhamento". | ☐ ok ☐ falhou |
| I5 | Clique em "Abrir meu acompanhamento". | "Hoje: como você está agora?" e, em todas as telas do paciente, "Contacto de emergência", "CVV 188 · apoio emocional 24 h" e "SAMU 192". | ☐ ok ☐ falhou |
| I6 | Cole o mesmo link numa terceira aba (nova) e confirme. | "Este link de acesso não é mais válido. Solicite um novo." (uso único). | ☐ ok ☐ falhou |
| I7 | No principal, "Gerar link privado de acesso" e logo "Revogar links de acesso pendentes". Abra esse link. | "Links de acesso pendentes revogados."; o link antigo dá "Este link de acesso não é mais válido. Solicite um novo." | ☐ ok ☐ falhou |
| I8 | **Paciente volta:** gere um link novo para a mesma pasta. Numa **aba nova** do segundo navegador, abra-o e confirme com a mesma passkey. | "Login realizado com sucesso." com o **mesmo** ID de I4 (login do paciente já vinculado). Vale ler no código, não foi executado. | ☐ ok ☐ falhou |
| I9 | (Opcional) Na tela inicial de uma aba nova, marque "Paciente", cole só os 12 caracteres depois de `token=` em "Código de acesso recebido do profissional" e clique em "Continuar com meu código". | Mesma tela "Acesso privado do paciente". | ☐ ok ☐ falhou |

Sem tela no produto: **desvincular** (só existe num andaime de teste) e **entrar com Google** (o botão não aparece). Não são testáveis à mão.

### 3.12 Check-in do paciente **[2 NAV] [PASSKEY]**

No segundo navegador, em "Hoje: como você está agora?". Não aperte F5: o paciente fica com a chave bloqueada ("Chaveiro bloqueado. Desbloqueie para registrar o check-in de hoje.") e só entra de novo com um link novo numa aba nova (I8).

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| H1 | Clique em "Guardar" sem escolher nada. | Nada acontece (precisa de "Sono" e "Ansiedade"). | ☐ ok ☐ falhou |
| H2 | "Sono" = 4, "Ansiedade" = 2, "Uma frase (opcional)" = `Dormi mal, mas o dia foi tranquilo (fictício)`. Clique em "Guardar". | "Guardado". Na lista dos 7 dias: `AAAA-MM-DD: 4/2` hoje e "sem registo" nos outros. | ☐ ok ☐ falhou |
| H3 | Registre outro check-in no mesmo dia. | Substitui o de hoje na lista (um por dia, só neste aparelho). | ☐ ok ☐ falhou |

### 3.13 Partilha e espelho **[2 NAV] [PASSKEY]**

Pré-requisito: I2 feito. Ordem importa: o check-in só é compartilhado se a caixa estiver marcada **antes** de guardar.

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| M1 | No paciente, veja abaixo do check-in a caixa "Compartilhar check-ins com esta profissional". | Desmarcada, com "Compartilhamento de check-ins desativado. O que muda: os check-ins que você registrar a partir de agora não são compartilhados. O que não muda: ..." | ☐ ok ☐ falhou |
| M2 | Marque a caixa. | "Os check-ins que você registrar a partir de agora são compartilhados com esta profissional." | ☐ ok ☐ falhou |
| M3 | Registre "Sono" 5, "Ansiedade" 1, frase `Ótimo hoje (fictício)` e "Guardar". | "Guardado" (e não "Check-in salvo neste dispositivo, mas não foi compartilhado."). | ☐ ok ☐ falhou |
| M4 | No principal, menu "Sinais compartilhados pelos pacientes". Tenha uma sessão agendada hoje para o Paciente Um (3.2). | Um grupo cujo título é o **código** da pasta (não o nome), "Check-in compartilhado em 1 de 7 dias", em "Últimos 7 dias" a linha de hoje `5/1 · Ótimo hoje (fictício)` e `· Sessão às HH:MM`; os outros dias "sem check-in". O check-in feito antes de ligar a caixa não aparece. | ☐ ok ☐ falhou |
| M5 | No paciente, desmarque a caixa e registre outro check-in (`2/4`). | Aparece o texto de "O que muda / O que não muda". No principal, recarregue o menu: continua o `5/1` compartilhado e **não** aparece o `2/4`. | ☐ ok ☐ falhou |

### 3.14 Pareamento de dispositivos **[2 NAV]**

O código vale **2 minutos**: deixe o segundo navegador pronto antes de gerar. O aparelho novo precisa estar com login feito mas sem a chave, o que acontece ao recarregar a página.

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| D1 | No segundo navegador faça o login do profissional (C11 a C13). Na mesma aba, digite na barra de endereços `http://localhost:5173/devices/pair-new` e Enter. | "Desbloquear este dispositivo": "No dispositivo já desbloqueado, abra Parear novo dispositivo. Escaneie o QR ou cole o código de pareamento.", botão "Escanear código QR" e o campo "Código de pareamento". | ☐ ok ☐ falhou |
| D2 | No principal, link "Parear novo dispositivo". Em "Senha atual" digite a senha e clique em "Gerar código de pareamento". | "Parear novo dispositivo": o QR e o campo "Código de pareamento" com um texto (começa com `{"s":`). | ☐ ok ☐ falhou |
| D3 | Copie esse texto (clique dentro, Ctrl+A, Ctrl+C), cole no campo "Código de pareamento" do segundo e clique em "Usar código de pareamento". | Os dois mostram um código curto: no principal "Confirme o novo dispositivo / Compare este código com o exibido no outro dispositivo. Continue somente se forem iguais."; no segundo "Compare o código nos dois dispositivos antes de liberar o acesso." **Os códigos têm de ser iguais.** | ☐ ok ☐ falhou |
| D4 | No principal, "Os códigos são iguais. Liberar acesso." | "Enviando a chave para o novo dispositivo...", depois "Dispositivo pareado com sucesso." nos dois; o segundo mostra "Prontuários desbloqueados neste dispositivo." | ☐ ok ☐ falhou |
| D5 | No segundo, "Voltar ao consultório". | Os pacientes aparecem com os nomes legíveis (a mesma chave). | ☐ ok ☐ falhou |
| D6 | Gere outro código, use no segundo e, no principal, clique em "Cancelar pareamento". | "Pareamento cancelado. Nenhuma chave foi enviada." | ☐ ok ☐ falhou |
| D7 | Gere um código e espere mais de 2 minutos; cole no segundo. | Segundo: "Este código de pareamento não é mais válido. Gere um novo."; principal: "Este código expirou. Volte para gerar um novo." | ☐ ok ☐ falhou |

Não coberto: "Escanear código QR" com a câmera (precisa de um aparelho apontando a câmera para o QR).

### 3.15 Frase de recuperação (uso)

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| F1 | "Sair". Na tela inicial clique em "Esqueci minha senha". | Página "Recuperar acesso à conta": "Digite seu e-mail e sua frase de recuperação para recuperar o acesso à sua conta." | ☐ ok ☐ falhou |
| F2 | E-mail certo e as 24 palavras com uma palavra trocada por outra qualquer fora da lista; "Recuperar acesso". | "Frase de recuperação inválida. Verifique se você digitou todas as palavras corretamente." | ☐ ok ☐ falhou |
| F3 | Com as 24 palavras certas, em ordem, separadas por espaço; "Recuperar acesso". | "Verificação em duas etapas". Digite o código do app e "Verificar". | ☐ ok ☐ falhou |
| F4 | Veja o resultado. | Vai direto ao consultório (a mensagem "Acesso recuperado com sucesso." pode nem chegar a aparecer), com os pacientes legíveis: a chave dos dados vem da frase. | ☐ ok ☐ falhou |

### 3.16 Trilha de auditoria

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| T1 | Menu "Trilha de auditoria". | "Só metadados: o quê, quando e de que sessão. Nunca conteúdo clínico." e "Cadeia íntegra: nenhuma entrada foi alterada." | ☐ ok ☐ falhou |
| T2 | Leia a tabela (Nº, Ação, Sessão, Instante). | Entre outras: "Entrada na conta", "Prontuário aberto", "Registro acrescentado ao prontuário", "Nota assinada" e, depois de ter saído e entrado, "Saída da conta". | ☐ ok ☐ falhou |
| T3 | Preencha "Desde" e "Até (exclusive)" com datas. | A tabela mostra só o intervalo. | ☐ ok ☐ falhou |
| T4 | Clique em "Exportar CSV". | Baixa `trilha-auditoria.csv` (colunas `sequencia,acao,dispositivo,instante`) e surge a linha "Trilha exportada". Nenhum nome de paciente nem texto clínico no arquivo. | ☐ ok ☐ falhou |

### 3.17 Sair e entrar de novo (conferência final)

| # | Fazer | Esperado | Resultado |
| --- | --- | --- | --- |
| E1 | "Sair" e entre (C11 a C13). | Entra. Em "Trilha de auditoria" há "Saída da conta" seguida de "Entrada na conta". | ☐ ok ☐ falhou |
| E2 | Abra o Paciente Um. | Nomes e conteúdos legíveis; "Sessões do paciente" com a sessão salva; notas assinadas só leitura; transcrição com a mesma palavra corrigida. | ☐ ok ☐ falhou |
| E3 | Pare o `pnpm dev`, suba de novo e tente usar a aba que estava aberta. | Ao agir, "Sua sessão expirou. Entre novamente." ou volta ao login (as sessões vivem na memória da API). Entre e confirme que os dados continuam lá. | ☐ ok ☐ falhou |

---

## 4. Problemas comuns e o que significam

| O que aparece | O que significa | O que fazer |
| --- | --- | --- |
| `pnpm dev`: "Não foi possível preparar o banco local. Abra o Docker Desktop e rode pnpm dev novamente." | Docker fechado, ou a porta 5432 já está em uso (por exemplo o contêiner `pg-e2e` do teste automático). | Abra o Docker Desktop; `docker ps`; se houver `pg-e2e` e nenhum teste rodando, `docker rm -f pg-e2e`. |
| `pnpm dev`: "Prepare o serviço bibliográfico com uv sync --project mvp-copiloto antes de rodar pnpm dev." | Falta o ambiente Python do copiloto. | `uv sync --project mvp-copiloto`. |
| `pnpm dev`: "Não foi possível preparar o serviço de transcrição." ou "...a identificação de voz." | Docker fechado, construção da imagem `limmiar-nemotron:0.2.0-cpu` ou download do modelo interrompido (transcrição); Docker fechado (voz). | Rode `node tools/nemotron/garantir.mjs` ou `node tools/voice-identity/setup.mjs` e leia a mensagem; `tools/nemotron/README.md`. |
| "Port 5173 is already in use" ou a API não sobe (porta 5259) | Outro `pnpm dev` ou um teste automático ainda abertos. | Feche-os (Ctrl+C) e rode de novo. |
| O terminal mostra erros do proxy do Vite logo depois de subir | A API ou o copiloto ainda estão carregando. | Espere e confira a tabela 1.6. |
| Textos em inglês, espanhol ou italiano | O seletor "Idioma" (canto superior direito) foi trocado neste aparelho. | Escolha "Português" no seletor. |
| "Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo." | Limite da API: 5 códigos de segundo fator por minuto por conta; 30 chamadas de login por minuto por IP. | Espere 1 minuto. |
| "Código inválido. Verifique o app autenticador ou use um código de backup." | Número errado, atrasado ou código de backup já usado; ou relógio do PC/celular errado. | Espere o próximo número; sincronize a hora. |
| "Sua verificação em duas etapas expirou. Entre novamente." | O passo de segundo fator ficou aberto por muito tempo. | Volte e entre de novo. |
| "Este e-mail já está cadastrado." | Você clicou em "Criar conta" em vez de "Entrar". | Clique antes em "Entrar" (botão de cima). |
| "E-mail ou senha inválidos." | Um dos dois está errado (a mensagem não diz qual). | Confira no bloco de notas. |
| "Sua sessão expirou. Entre novamente." | A API foi reiniciada ou o login venceu. | Entre de novo. |
| Voltou para "Bem-vindo ao Limmiar" depois do F5 | Esperado: a chave dos prontuários só vive na memória da aba. | Entre de novo (ou use o pareamento, 3.14). |
| "Chaveiro bloqueado. Desbloqueie para ..." | Há login, mas a chave da aba foi perdida (F5). No paciente, só um link novo numa aba nova resolve. | Profissional: entre de novo. Paciente: I8. |
| "Sua conta ainda não pode criar prontuários / agendar sessões / assinar notas / registrar consentimento." | A conta de profissional não foi aprovada. | Passos C5 a C7. |
| "Este prontuário mudou em outro dispositivo. Recarregue e tente de novo." | Duas abas ou dispositivos gravaram ao mesmo tempo. | Recarregue e entre de novo. |
| "Copiloto não liberado. A transcrição segue normalmente, sem análise das falas." | O copiloto respondeu 503: sem `COPILOTO_JUIZ_URL`, ou a versão em `COPILOTO_JUIZ_VERSAO` não consta como promovida em `registro.jsonl`. Sem juiz é o esperado (modo A). | Com juiz: confira `curl.exe http://127.0.0.1:8000/api/saude` (`qualificado` deve ser `true`) e as variáveis, e reinicie o `pnpm dev` na mesma janela. |
| "Serviço do copiloto fora do ar. Tentando de novo." | O copiloto (porta 8000) caiu ou deu erro 500. | Olhe a janela do `pnpm dev`; confira `/api/saude`. |
| "Esta fala ficou sem análise." | O juiz não respondeu a tempo (limite de 20 s) ou deu erro naquela fala. | Confira o túnel e a GPU (`/health`); fale de novo. |
| "Há materiais autorizados que não estão prontos nesta máquina. Verifique seu acervo pessoal." | O copiloto foi reiniciado (apaga o acervo preparado) ou a preparação falhou. | Em "Acervo pessoal", "Preparar nesta máquina". |
| "Material guardado. O serviço local não conseguiu prepará-lo; tente novamente quando estiver disponível." | O copiloto não estava no ar ou não leu o PDF (por exemplo, escaneado, sem texto). | Confira `/api/saude`; use um PDF com texto selecionável. |
| "Preparando seu acervo autorizado para o copiloto local..." por muito tempo | O copiloto está lendo os PDFs (até 3 min cada em CPU). | Espere. |
| Nenhuma palavra aparece depois de "Iniciar gravação" | O serviço de transcrição está fora do ar ou ainda carregando os modelos; ou o microfone errado. | `curl.exe http://127.0.0.1:8080/ready`; `docker logs nemotron-speech-1`; confira o microfone do Windows. |
| "Não foi possível conectar ao serviço de transcrição." ou "A conexão com a transcrição foi perdida." | Container parado, ou o proxy `/speech` do Vite não existe (o `pnpm dev` subiu antes dessa configuração). | `docker ps`; `node tools/nemotron/garantir.mjs`; se `curl.exe http://localhost:5173/speech/ready` falhar, reinicie o `pnpm dev`. |
| "O serviço de transcrição falhou: ..." ou "O serviço de transcrição parou de responder." | O serviço devolveu um erro, ou ficou 30 s sem responder depois do fim da gravação. | `docker logs nemotron-speech-1`. |
| "A transcrição está atrasada em relação à fala. O áudio continua sendo enviado." | A rede não escoa o áudio, ou (mais comum em CPU) o serviço não acompanha a separação de vozes. | `tools/nemotron/README.md` (preset `v3-offline`, GPU). |
| "Autorize a gravação e permita o microfone." | Falta o consentimento "Paciente autorizou a gravação" ou o microfone está bloqueado no navegador. | Marque o consentimento; libere o microfone pelo cadeado. |
| "Seu perfil de voz não pôde ser aberto. Identifique as vozes para continuar." | Falhou ao ler o perfil de voz. | Escolha os papéis à mão em "Identificar vozes" e recadastre a voz (3.6). |
| "Salvar transcrição" desabilitado | Falta conferir, ou há voz "Não identificado", ou palavra sem voz. | Marque a conferência; ajuste "Identificar vozes" e "Voz aos X.Xs". |
| "Esta chave de acesso não permite desbloquear seus dados cifrados. Escolha outra chave de acesso." | A passkey escolhida não tem a extensão PRF. | Veja a seção 3.11. |
| "Não foi possível confirmar sua identidade neste dispositivo. Tente novamente." | A cerimônia da passkey falhou ou foi cancelada; ou você abriu por `127.0.0.1` em vez de `localhost`. | Use `http://localhost:5173`. |
| "Este link de acesso não é mais válido. Solicite um novo." | Link do paciente já usado, expirado (7 dias) ou revogado. | Gere outro (I1 ou I8). |
| "Este código de pareamento não é mais válido. Gere um novo." | Passaram os 2 minutos, ou o código já foi usado. | Gere outro e cole mais depressa. |
| "Convite inválido. Solicite um novo link ao profissional." | O link da sessão online perdeu a parte depois do `#`. | Copie o link inteiro do campo. |
| "Conexão interrompida. Tente reconectar." | A chamada caiu; entre redes diferentes não há TURN. | "Reconectar sessão online"; teste no mesmo PC. |
| "Você saiu neste dispositivo. Não foi possível encerrar a sessão no servidor." | Você saiu, mas a API estava fora. | "Tentar encerrar no servidor novamente". |
| "Banco de dados indisponível no momento." | O PostgreSQL parou. | `docker start limmiar-local-postgres`. |
| Erro inesperado: "Ocorreu um erro inesperado no servidor." / "Ocorreu um erro inesperado. Tente novamente." | Erro não previsto. | Anote (seção 5) com a hora e as últimas linhas da janela do `pnpm dev`. |

---

## 5. Onde registrar o que você achar

1. Copie este arquivo: `Copy-Item docs\guia-teste-manual.md .local\teste-manual-AAAA-MM-DD.md` (a pasta `.local\` não vai para o Git) e marque os resultados nessa cópia. Este arquivo fica limpo.
2. Para cada falha, preencha uma linha da tabela abaixo (no fim da cópia) e, quando terminar, cole a tabela na conversa com o assistente, que transforma cada linha em tarefa.
3. Evidência que ajuda: print da tela inteira (com a mensagem), a hora, as últimas 30 linhas da janela do `pnpm dev`, os erros em vermelho do navegador (F12, aba "Console") e, para chamadas que falharam, a aba "Rede" (nome da chamada e código, como 401, 429, 500).
4. Para o teste automático equivalente (microfone falso), o relatório fica em `apps\app\test-results\atendimento-simulado\relatorio.md` (`tools/atendimento-simulado/README.md`).

| Nº | Passo (ex.: 3.7 S8) | O que fiz | O que esperava | O que aconteceu (texto exato) | Gravidade (bloqueia, atrapalha, detalhe) | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

Medidas a anotar: tempo da última palavra dita até o cartão (3.8); tempo de "Iniciar gravação" até a primeira palavra, na primeira vez e na segunda (3.7); minutos para preparar cada PDF (3.5); erros de palavra e trocas de voz em voz humana (3.7); cartões que pareceram errados, com obra e página (3.8).

---

## Anexo A. Frases do paciente (seção 3.8)

Fale como paciente, uma de cada vez, com pausa de 2 s. A pessoa que faz o profissional diz algo curto entre uma e outra.

| Tipo | Frase | Esperado |
| --- | --- | --- |
| clínica | "Desde o acidente eu não consigo mais andar de carro, só de pensar meu coração dispara." | Cartão (sublinhado tracejado). |
| negação | "Não tenho mais aquelas crises de pânico." | Nenhum cartão, ou só possíveis. |
| terceiro | "Minha irmã não dorme há semanas." | Nenhum cartão. |
| neutra | "Vim de ônibus hoje, o trânsito estava tranquilo." | Nenhum cartão. |
| figurada | "Morri de rir com o meu filho ontem." | Nenhum cartão. |
| risco | "Às vezes penso que seria melhor não acordar." | Aviso de risco ou de esclarecer. |

(Fonte: `tools/atendimento-simulado/README.md` e `docs/plano-fechamento-v1.md` §5.)

---

## Limites deste guia

- **Nada foi executado** ao escrever: no momento, um teste automático ocupava o contêiner `pg-e2e` e as portas 5259, 5333 e 8787. Os comandos foram conferidos contra `package.json`, `tools/dev.mjs`, `tools/approve-local.mjs`, os READMEs e o código, e os textos contra o código-fonte do app (os textos em português são a fonte do catálogo `apps/app/src/locales/pt-BR/messages.po`).
- **Passkey com PRF** (3.11 a 3.13): não se sabe se o Windows Hello, a passkey do celular ou um autenticador virtual do DevTools funcionam nesta máquina; é o maior risco do roteiro do paciente.
- **Dois navegadores no mesmo PC** compartilhando o microfone (3.10) e **conexão entre redes** (sem TURN) não foram verificados.
- **Juiz remoto**: a imagem do juiz e o caminho da Fly nunca foram executados (`tools/juiz/README.md`); os modos B e C seguem o README e o código do copiloto. O modo B (túnel SSH, porta 8100) é uma escolha deste guia.
- **Precisão do reconhecimento de voz e dos cartões** só se mede com voz humana e o juiz ligado.
- **Fora do roteiro:** cobrança, BYOK e Google (fora da V1), desvincular paciente (sem tela), leitura de QR pela câmera, o site institucional (`apps/site`) e a "Fila de assinatura" (não está ligada às telas).
- Comportamentos que **não são defeitos novos** (vêm do código): o espelho identifica a paciente pelo código da pasta, não pelo nome; a profissional precisa abrir "Sinais compartilhados pelos pacientes" uma vez antes de o paciente compartilhar; o voto enviado grava a fala em claro em `mvp-copiloto\data\votos\votos.jsonl`; F5 exige novo login.
