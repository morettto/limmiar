Type: grilling
Status: open

## Question

PR#8 flagou: `AccountService` acumula parametros opcionais/defaulted no construtor "pra call sites antigos continuarem compilando" -- exatamente o padrao de shim de backward-compatibility que AGENTS.md proibe. Presente desde S02-02..S02-08, nao corrigido (corrigir exige atualizar ~10 arquivos de teste). Esta reestrutura corrige esse debito (quebra os call sites, atualiza os testes), ou fica fora de escopo e vira ticket a parte depois?
