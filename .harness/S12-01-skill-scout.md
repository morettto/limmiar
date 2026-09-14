# skill-scout — S12-01

Cruzamento de `ficheiros_previstos` (por extensão) com `.harness/skills-map.json`:

| Extensão no diff previsto | Mapa | Resultado |
|---|---|---|
| `.cs` | `review-dotnet-csharp` | mapeado — etapa 7 corre com esta skill |
| `.sql` (migração 0009) | `review-sql-data` | mapeado — etapa 7 corre com esta skill |
| `.json` (fixtures) | ausente do mapa | sem domínio próprio; coberto pelos testes de contrato |
| `.yml` (job de drift) | **ausente do mapa** | procura externa feita — ver abaixo |

## Domínio sem mapa: GitHub Actions / YAML de CI

1. Inventário local: nenhuma skill instalada cobre GitHub Actions. As skills de review
   locais são as três de `.harness/skills-map.json` (dotnet, sql, typescript-react).
2. Procura externa corrida: `npx skills find "github actions workflow ci"`.
   Candidatos com tração:
   - `github/awesome-copilot@create-github-action-workflow-specification` (10.5K instalações)
   - `ruvnet/ruflo@agent-ops-cicd-github` (1.2K)
   - `nickcrew/claude-cortex@github-actions-workflows` (39)
3. Resultado: **nada instalado, vai com o baseline.** Sem autorização do utilizador para
   instalar, e o repositório já tem quatro workflows como molde direto
   (`deploy-api.yml`, `deploy.yml`, `mutation-nightly.yml`, `quality-gates.yml`) —
   o `mutation-nightly.yml` é o precedente mais próximo de job agendado.
   Se o utilizador quiser a skill, o candidato é o primeiro da lista.

## Correção a uma invariante do handoff

O handoff `2026-09-08T2330 S12-01 dev-dev` afirma "Nenhum workflow tem `schedule:`. O job
de drift é o primeiro cron do repositório." **É falso.** `.github/workflows/mutation-nightly.yml`
já corre em `schedule: - cron: '17 3 * * *'` mais `workflow_dispatch`. Existe molde no
repositório para o job de drift, e a convenção de cron fora da hora cheia está lá comentada.
Correção enviada ao subagente do portão da forma.
