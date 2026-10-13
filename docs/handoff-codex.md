# Passagem para o Codex (13/10/2026)

Estado do trabalho feito com o Claude Code no branch `codex/copiloto-mvp`. Nada foi commitado nem enviado (`git status`
mostra centenas de caminhos fora do Git); o dono ainda não autorizou commit. Leia `AGENTS.md` antes de tudo.

## Decisões do dono (valem como requisito)

- Transcrição fluida e em **tempo real** em qualquer aparelho e navegador (PC, tablet, celular; Zen/Firefox incluídos). "Gravar e
  transcrever depois" está descartado.
- **Saber quem fala é obrigatório.** Profissional à direita, paciente à esquerda; texto contínuo, só quebra quando muda o falante.
- O áudio pode passar pelo servidor **sem ser gravado** (só memória). O texto vai ao juiz. A impressão de voz do profissional vai
  ao gateway por sessão, só em memória.
- Votos útil/não útil vão ao servidor com consentimento e alimentam o retreino do juiz.
- Modelo do juiz: **Gemma 4 E4B + LoRA v2** (o E2B foi treinado e perdeu em todas as medidas). Transcrição: **Nemotron 3.5
  streaming via NeMo-Speech.cpp 0.2.0**. Cloudflare só para o app (o Workers AI não roda modelo próprio hoje).
- Deploy é o último passo. Construir imagens de produção só depois de tudo aprovado.

## Arquitetura da transcrição (pronta e medida)

```
navegador ─WS /speech/v1/fala─▶ gateway de fala (apps/gateway-fala) ─WS─▶ NeMo-Speech 0.2.0 (N containers)
  porta de voz corta o silêncio   TitaNet por frase decide o falante        Nemotron 3.5 ASR, sem diarização
```

- App: `apps/app/src/shared/audio/{transcricao-servidor,porta-de-voz,mapa-de-tempo,capturar-pcm,realtime-pcm.processor}.ts`,
  UI em `features/live-session` e `entities/insight/blocos-transcricao.ts`.
- Gateway: `apps/gateway-fala/src` (pool de instâncias `pool.ts`, verificação por frase, só envia o que é novo, rotação da
  sessão upstream a cada ~3 min). Protocolo para o app: `parcial {texto}`, `final {frase, falante, palavras}`, `falante`, `concluida`.
- Serviço: `tools/nemotron/{Dockerfile,garantir.mjs,README.md}`. Imagens `limmiar-nemotron:0.2.0-cpu` e `-cuda` saem do
  Dockerfile (pacote oficial com SHA-256). CPU: 2 containers fixos em 2 núcleos cada; GPU: `NEMOTRON_DISPOSITIVO=cuda`.
- Números medidos (diálogo de 43 s com gabarito): palavra até a tela mediana −0,03 s / pior 0,32 s (1 sessão); 98,4% de acerto
  de falante; rótulo ~1,1 s após a frase; silêncio de 30 s não trava. Nuvem: uma RTX A4000 (US$ 0,09/h) aguentou 64 sessões
  estáveis. Detalhes e armadilhas (ggml disputa núcleos, `--threads` = vagas HTTP, `state_arena_slots`) no README do nemotron.

## Juiz e copiloto

- `mvp-copiloto/` (Python). Juiz local: `tools/juiz/local.ps1` (llama.cpp, LoRA v2 em GGUF); o dono roda o script com `!`
  porque o classificador de permissões bloqueia executar binário baixado. Registro de versões: `mvp-copiloto/data/juiz-v2/registro.jsonl`.
- Ciclo de retreino e regra de promoção: `docs/juiz-ciclo-de-treino.md`, `mvp-copiloto/scripts/juiz_v2/ciclo.py` (votos
  separados por obra para medir a melhora).

## Como subir local

`pnpm dev` (Docker Desktop aberto). Para o juiz: rodar `tools/juiz/local.ps1` antes, com `COPILOTO_JUIZ_CHAVE` igual nos dois
lados, e exportar `COPILOTO_JUIZ_URL/CHAVE/VERSAO/MODELO`, `COPILOTO_BASE_MODELO`, `COPILOTO_REESCRITA_MODELO` antes do
`pnpm dev`. Aprovar conta: `LIMMIAR_API_URL=http://127.0.0.1:5259 LIMMIAR_STAFF_API_KEY=<StaffAccess.ApiKey de .local/settings.json>
node tools/approve-local.mjs <email>` (depois de enviar o documento na interface). Guia: `docs/guia-teste-manual.md`.
Feche jogos (VALORANT) antes de medir: eles disputam CPU/GPU e contaminam as medições.

## Verificado por último

- App: `tsc -b`, lint, `test:unit` 1.941 testes, 100% de cobertura. Gateway: 111 testes, 100%. Python do copiloto: 148 testes.
- API .NET: 908 testes, 100% (rodado antes das últimas mudanças, que não tocaram C#).

## Pendente

1. Teste do dono com voz humana no Zen, depois celular e 4G.
2. Suíte E2E: interrompida por falta de memória. Portas agora configuráveis (`E2E_API_PORTA`, `E2E_PG_PORTA` em
   `apps/app/playwright.config.ts`); rodar com o `pnpm dev` desligado ou com memória sobrando.
3. Commit em fatias e PR (aguarda o dono). Os pesos `*.safetensors` estão no `.gitignore`.
4. Deploy (por último): app na Cloudflare; GPU para Nemotron + gateway e para o juiz em São Paulo (AWS `g6.xlarge` foi a
   recomendação de `docs/hospedagem-nemotron-juiz.md`).
5. Reforço de vocabulário clínico por sessão (`speech_contexts` do NeMo-Speech) para precisão; não implementado.

## Documentos de referência

`docs/plano-fechamento-v1.md`, `docs/pesquisa-nemotron-asr-escala.md`, `docs/hospedagem-nemotron-juiz.md`,
`docs/analise-asr-celular.md`, `docs/adr/ADR-0012-transcricao-no-servidor.md`, `tools/nemotron/README.md`,
`apps/gateway-fala/` (código e testes), `docs/guia-teste-manual.md`.
