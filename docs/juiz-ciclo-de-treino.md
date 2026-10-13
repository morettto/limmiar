# Ciclo de treino do juiz

O juiz decide se um trecho do material do profissional explica a fala do paciente. Os PDFs do
profissional nunca treinam nada: só alimentam a busca. O que melhora o juiz são os **votos**
"útil / não útil" sobre os cartões, mais o teste fixo que decide se uma versão nova pode entrar.

## 1. Voto (contrato)

Uma linha JSON por voto, gerada no aparelho do profissional e **só enviada com consentimento**:

```json
{"v":1,"consentiu":true,"usuario":"<pseudônimo estável>","fala":"...","contexto":["..."],
 "trecho":"...","obra":"<nome da obra>","voto":"util|nao_util","juiz":"<versão>","em":"2026-10-08T10:00:00Z"}
```

O app envia o voto com `POST /copiloto/api/votos?accountId=<id>` (Bearer da conta, a mesma autorização do
acervo pessoal), **só depois do consentimento do profissional**. O serviço responde 204 e anexa a linha a
`mvp-copiloto/data/votos/votos.jsonl` (ignorado pelo git); 400 se `consentiu` não for `true`, o evento for
inválido ou passar dos limites (corpo 16 KB, fala 2000, trecho 3000, contexto 5 itens de 2000, demais campos 200).
Corpo e `usuario` nunca vão para log. Sem `consentiu: true` o voto é descartado. Um voto é dado de saúde (traz a fala do paciente):
exige consentimento por finalidade, anonimização do `usuario` e revisão jurídica antes de sair
do aparelho. Enquanto isso não existir, os votos servem só ao ajuste local.

## 2. Limpeza (`src/copiloto/votos.py`)

Vale o último voto de cada usuário em cada par; entre usuários, a maioria. Saem: sem
consentimento, par do teste fixo, trecho que não é prosa, poucos usuários, empate. Aceitar não
é o mesmo que acertar, então o voto é sinal com ruído: antes de cada retreino se confere uma
amostra à mão.

## 3. Teste fixo (`scripts/juiz_v2/teste_fixo.py`)

Congelado, com hash em `data/juiz-v2/teste-fixo.manifesto.json`. Contém:
- todas as obras de teste (uma em cada cinco, escolhida pelo nome do arquivo, para sempre);
- todos os rótulos do profissional (os 100 cartões), que valem mais que os meus.

Nada disso entra em treino: nem a obra, nem o par. Mudar o teste fixo exige `--nova-versao` e
reavaliar o juiz ativo. Rodar: `python teste_fixo.py construir`.

## 4. Retreino e decisão

```
python ciclo.py montar treino-ciclo.jsonl [votos.jsonl]       # base + votos (padrão data/votos/votos.jsonl), sem o teste fixo
python treinar_lora.py MODELO treino-ciclo.jsonl -1 3 adaptador 2  # na VM
python prever_lora.py MODELO adaptador teste-fixo.jsonl candidato.previsoes.jsonl
python prever_lora.py MODELO ativo   teste-fixo.jsonl ativo.previsoes.jsonl
python ciclo.py decidir candidato.previsoes.jsonl ativo.previsoes.jsonl
```

O candidato **só é promovido** quando passa nas duas réguas (o teste fixo e as notas do profissional):
- **Teste fixo, só regressão** (limiar de operação 0,9): a precisão dos aprovados não cai mais de 0,02 e o AUROC geral
  não pode ter caído mais de 0,005 (percentil 5 de 1.000 reamostragens); precisa de pelo menos 80 casos difíceis.
- **Melhora, pelas notas do profissional** (previsões nas avaliações reservadas por obra, `rotulos-5k-suave-teste.jsonl`):
  a correlação de Spearman com a nota sobe pelo menos 0,10 e a precisão na faixa "sim" (nota >= 0,9) também.
  Sem notas, vale a regra antiga: precisão +0,05 sem perder mais de 0,10 de cobertura.

O AUROC dos casos difíceis é só informativo. A regra mudou duas vezes depois de ver resultados (2026-10-08): a primeira
barrou a v1 por um AUROC instável com 9 positivos; a segunda barrou a v2 porque a precisão da v1 já estava em 96% no
teste fixo (não há folga para +0,05) enquanto as notas do profissional mostravam a diferença real. Cada promoção é
registrada em `mvp-copiloto/data/juiz-v2/registro.jsonl`.

## 5. Liberação por versão

O copiloto atende a versão do juiz que vem em `COPILOTO_JUIZ_VERSAO` (a tag da imagem) só se ela constar em
`mvp-copiloto/data/juiz-v2/registro.jsonl` com `"promovida": true` (regra do §4) e com `limiares` válidos
(`forte` e `possivel`). Sem isso a rota de produto responde 503. Não há liberação por conta: quem usa uma versão
promovida usa a mesma que todos. Cada linha NDJSON da consulta traz o campo `juiz` (essa versão), que o app copia
para o voto.

Os cartões usam as faixas do registro da versão ativa: `forte` com probabilidade a partir de `limiares.forte`,
`possivel` entre `limiares.possivel` e `limiares.forte`, e abaixo de `limiares.possivel` o cartão não sai (a v2: 0,9 e
0,7). Todos os candidatos (40) são julgados e os fortes vêm primeiro. `data/limiares-juiz-llm.json` guarda só os
limiares do portão (clínica, risco, ambígua).

## Limites

- A reamostragem é por par, não por obra, então a incerteza real é maior que a calculada.
- O adaptador v0 (`data/juiz-v2/lora/final`) viu obras de teste e está aposentado. A v1
  (`data/juiz-v2/lora/v1`) foi treinada sem elas; o ativo inicial de comparação é o modelo base.
- Cada versão precisa de nova conversão para o formato do navegador (ver ADR-0011).

## Qualificação de 5 mil falas (2026-10-08)

Falas sintéticas geradas a partir do acervo de teste (obras que o juiz nunca viu): 3.092 positivas (3 por trecho, sem
vocabulário técnico, com a fonte conhecida), 800 neutras, 600 de expressão figurada, 300 do terapeuta e 300 ambíguas.
Scripts em `mvp-copiloto/scripts/juiz_v2/`: `gerar_frases.py`, `qualificar5k.py`, `revisao_html.py`, `rotulos_5k.py`.

Resultado (juiz v1, limiar 0,9, até 3 cartões por fala, 6 falas em paralelo):
- positivas com cartão: 1.211 de 3.092 (39%); a fonte exata aparece em 290 (9%), a página dela em 396 (13%);
- neutras 0/800, terapeuta 0/300, expressão figurada 23/600 (3,8%), ambíguas 7/300 e pedido de esclarecimento em 194/300;
- primeiro cartão em 8,5 s (p50) e 12,9 s (p95) com 6 falas simultâneas na mesma GPU (sequencial foi 2,6 s).

Avaliação humana: `data/juiz-v2/q5k/revisao/rotular-5k.html` (300 cartões: 75 na fonte exata, 188 em outros trechos,
37 de falas negativas). Depois de baixar `rotulos-5k.json`:
`python rotulos_5k.py data/juiz-v2/q5k/revisao/rotulagem-5k.json rotulos-5k.json data/juiz-v2/q5k`.
A taxa de acerto da `fonte_exata` diz se as falas geradas valem como positivo; metade das obras vira treino e metade
teste novo, e a v2 só entra pela regra de promoção.

## v2 (2026-10-08)

Treinada com o treino da v1 mais 164 cartões com a nota do profissional como alvo suave (inclusive as dúvidas), 2 épocas.
Nas 101 avaliações reservadas (7 obras que nenhuma versão viu): correlação com a nota 0,65 (v1 0,36; base 0,60); aprova 23
de 101 em vez de 96, com 57% na faixa sim (v1 18%) e 77% de cobertura dos sim. Teste fixo: precisão 97,7% (v1 96,2%),
cobertura 62% (v1 72%), AUROC geral 0,974 (v1 0,967). Como a v2 foi treinada para prever a nota, a previsão tem a escala
do profissional: >= 0,9 é "sim" e 0,7 a 0,9 é "dúvida".

## Votos: treino e medição (2026-10-09)

`ciclo.py montar` separa os votos limpos por obra (mesma regra de `rotulos_5k.lado`): as obras do lado "treino" entram no treino da próxima
versão; as do lado "teste" vão para `SAIDA.votos-teste.jsonl` (`alvo_suave` 0 ou 1) e nunca treinam. Depois do treino, gere previsões do
candidato e do ativo nesse arquivo com `prever_lora.py` e passe-as como 4º e 5º argumentos de `ciclo.py decidir`: a melhora é medida pelo
que os profissionais votaram em obras que o modelo não viu. Ainda não há votos reais; o caminho está testado com votos sintéticos.
Teto honesto: com rótulo humano ruidoso e obras novas a cada profissional, a precisão tende a subir e estabilizar, não chega a 100%.
