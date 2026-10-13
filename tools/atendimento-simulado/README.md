# Atendimento simulado

Duas formas de percorrer o mesmo roteiro (`docs/plano-fechamento-v1.md`, §5): a automatizada
(Playwright, microfone falso) e a manual, com voz humana, que este arquivo descreve.
O teste automatizado prova o caminho; só a voz humana mede se o reconhecimento e o juiz funcionam de verdade.

## Versão automatizada

```
docker run -d --name pg-e2e -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=limmiar_e2e postgres:17-alpine
cd apps/app && pnpm exec playwright test e2e/atendimento-completo.spec.ts
docker rm -f pg-e2e
```

Leva uns 3 minutos. Precisa do modelo de voz local (`node tools/voice-identity/setup.mjs`); sem ele o teste é ignorado. O relatório do roteiro (passo, ok ou falhou, tempo, o que foi simulado) fica em
`apps/app/test-results/atendimento-simulado/relatorio.md`. Duas fronteiras são simuladas: o serviço de transcrição
(WebSocket `/speech`, que o fake atende com `page.routeWebSocket` no protocolo do servidor) e o copiloto/juiz (`/copiloto/api`). O relatório diz quais.
O fake do servidor fica em `apps/app/e2e/fixtures/atendimento/asr-simulado.ts`.

## Versão manual, com voz humana

Preparação: `pnpm dev` com `COPILOTO_JUIZ_URL`, `COPILOTO_JUIZ_CHAVE` e `COPILOTO_JUIZ_VERSAO` apontando
para o juiz de teste e a liberação de teste da D1 registrada. Navegador limpo, conta fictícia, paciente fictício,
um lugar silencioso e dois microfones ou duas vozes (a sua e a do "paciente", de outra pessoa ou de um segundo aparelho).

| # | Passo | Esperado |
|---|-------|----------|
| 1 | Criar a conta de profissional, configurar o TOTP e, em "Frase de recuperação", gerar e anotar a frase. | Códigos de backup e frase exibidos uma vez. |
| 2 | Enviar a referência do documento. Em outro terminal: `LIMMIAR_API_URL=http://127.0.0.1:5259 LIMMIAR_STAFF_API_KEY=<StaffAccess.ApiKey de .local/settings.json> node tools/approve-local.mjs <email>`. Clicar em "Atualizar verificação". | Aparece "Pacientes e prontuário". |
| 3 | Em "Acervo pessoal", guardar 2 ou 3 PDFs próprios e marcar "Autorizar nas minhas consultas". | "Preparado nesta máquina". |
| 4 | Em "Identificação da sua voz", autorizar o microfone e ler em voz normal, por 15 s: "Minha voz ajuda a organizar a conversa, respeitando o tempo de cada pessoa." / "Durante a sessão, escuto com atenção e faço perguntas para compreender melhor." / "Este é meu cadastro de voz. As falas do paciente devem permanecer separadas das minhas." | "Perfil de voz salvo." |
| 5 | Adicionar um paciente fictício, agendar uma sessão para hoje e, no painel "Seu dia no consultório", clicar em "Iniciar próxima: ...". | O paciente abre e o foco vai para "Tipo de sessão". |
| 6 | Em "Acesso e consentimentos", marcar a gravação e a análise por IA. Clicar em "Iniciar gravação". | "Transcrição ao vivo..." e o microfone abre. |
| 7 | Falar uma frase de cada tipo (tabela abaixo), como paciente, com pausa de 2 s entre elas. A pessoa que faz o profissional diz algo curto entre uma e outra. | Ver a coluna "Esperado". |
| 8 | Conferir em "Identificar vozes" que uma voz é "Profissional" e a outra "Paciente". Na fala clínica, ver o sublinhado tracejado, abrir com Tab e Enter e conferir as fontes fortes e, em "Possíveis: confira antes de usar", as outras: autor, página, parágrafo e citação. | Fala clínica tracejada; fortes abertas; possíveis fechadas. |
| 9 | Votar "Útil" ou "Não útil" em pelo menos 5 cartões. Responder à pergunta de envio conforme a D3 (recomendado: "Só neste aparelho"). | Botão marcado; nada sai para `/copiloto/api/votos` se escolheu "Só neste aparelho". |
| 10 | "Pausar sessão", "Retomar sessão" e "Encerrar gravação". Em "Corrigir texto e voz por palavra", corrigir uma palavra, marcar "Conferi o texto..." e "Salvar transcrição". | "Transcrição salva no prontuário." |
| 11 | Em um cartão, "Escolher referência para a nota", confirmar, escrever o Subjetivo e a Avaliação e "Assinar nota". | "Nota assinada e salva no prontuário." |
| 12 | Abrir "Trilha de auditoria". Depois, "Sair". | "Cadeia íntegra"; entradas de entrada, prontuário aberto, registro acrescentado e nota assinada. |
| 13 | Entrar de novo com TOTP. Abrir o paciente, "Histórico do prontuário", "Abrir nota", "Ver fala da referência". | Mesma contagem de palavras, palavra corrigida mantida, mesma referência, nota só leitura. |
| 14 | Opcional: repetir no modo online, com o convite em outro navegador, negando o microfone uma vez. | Sem áudio salvo; aviso claro de microfone negado. |

### Frases do passo 7

| Tipo | Frase | Esperado |
|------|-------|----------|
| clínica | "Desde o acidente eu não consigo mais andar de carro, só de pensar meu coração dispara." | Cartão. |
| negação | "Não tenho mais aquelas crises de pânico." | Nenhum cartão, ou só possíveis. |
| terceiro | "Minha irmã não dorme há semanas." | Nenhum cartão. |
| neutra | "Vim de ônibus hoje, o trânsito estava tranquilo." | Nenhum cartão. |
| figurada | "Morri de rir com o meu filho ontem." | Nenhum cartão. |
| risco | "Às vezes penso que seria melhor não acordar." | Aviso de risco ou de esclarecer. |

### O que anotar

Para cada passo: funcionou ou falhou. Para as frases: o tempo até o primeiro cartão (cronometrar da última palavra
dita ao cartão na tela) e os cartões que pareceram errados. A tela não tem marcação de "dúvida"; anote a obra e a
página à mão. Se a voz do paciente ficar sem papel (nenhuma das duas vozes identificada), anote o ambiente e repita o
passo 4 em um lugar mais silencioso.
