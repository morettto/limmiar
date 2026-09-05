# ADR-0011 · Store→Service não devolve tuplo nullable nem usa `!` na fronteira

## Contexto

Em S04-02, a ronda 1 de review apanhou guardas duplicadas entre `ScheduledSessionStore.MoveAsync`/`CancelAsync` e extraiu `LockAndGuardAsync`. A correção trocou o wrapper apagado (`ScheduledSessionMutation`) por `var (_, rejection) = await LockAndGuardAsync(...)` com `session!` a atravessar a fronteira store→service em `SchedulingService`. A nulidade que o wrapper anterior tornava explícita voltou a existir em runtime sem o compilador conseguir avisar. Só a ronda 2 do thermo-nuclear apanhou isto -- obrigou a re-correr thermo e segurança sobre o diff inteiro da ronda 1, mais uma segunda verificação independente de build/testes.

## Decisão

Métodos de store deste repositório que cruzam para a camada de service devolvem sempre o tipo de resultado do domínio (ex.: `SchedulingResult`, o padrão já usado por `PatientService`/`Api.Platform.Result<TValue, TFailure>`) diretamente -- nunca um tuplo anónimo `(T?, Reason?)`, e nunca com `!` a apagar uma nulidade real na fronteira. Se o store precisa de comunicar mais de uma condição de falha, os campos entram nomeados no próprio tipo de resultado, não num tuplo posicional que o chamador tem de desempacotar e forçar.

## Consequências

- Revisões futuras (thermo-nuclear, humano) passam a ter uma regra objetiva e citável para esta fronteira, em vez de reconstruir o argumento a cada módulo novo.
- Qualquer módulo vertical novo (S05/S06 seguem o mesmo molde de `Api.Patients`) desenha a fronteira store→service assim desde o início, evitando repetir o percurso de duas rondas de S04-02.
- `ponytail:` sem analisador automático (Roslyn/EditorConfig) a impor isto ainda -- é disciplina de review, não de compilador. Se a fronteira store→service voltar a reaparecer em review noutro módulo, o upgrade é uma regra Roslyn que bloqueia `!` a cruzar Store→Service, não mais uma ronda manual.
