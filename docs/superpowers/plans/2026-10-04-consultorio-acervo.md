# Consultório por paciente e acervo pessoal

**Objetivo:** organizar a carteira em pastas de paciente com sessões reais e oferecer upload, recuperação e exclusão de materiais pessoais cifrados, com autorização explícita para consulta pelo copiloto local.

**Arquitetura:** pastas são uma metáfora visual sobre os IDs existentes. Transcrições são agrupadas pelo `transcriptId`, preservando suas revisões; notas sem vínculo não são atribuídas por data. O acervo tem armazenamento separado do prontuário: DEK por material, KEK em RAM, AAD por conta/material/finalidade, metadados e arquivo cifrados separados, API com RLS e acesso de profissional.

**Referências:** `docs/v1-criterios-de-aceite.md`, `docs/implementacao-final-limmiar.md`, `docs/design/frontend-editorial-reference.md`, spec S03 do vault.

## Restrições

- Preservar mudanças existentes; sem commit, push ou reset nesta execução.
- Não alterar captura/juiz sem coordenação com o agente principal.
- Não persistir áudio; PDF/TXT bibliográficos são materiais distintos de gravações.
- Creme, serifas, metadados mono, bordas finas, sem sombras; estados explícitos e navegação acessível em celular.
- Vitest com `--maxWorkers=2`; testes API em Release; manter cobertura de 100% por arquivo.

## Execução

- [x] API de materiais: migration `0018_professional_materials.sql`, módulo `Features/Materials`, testes de armazenamento/endpoints, RLS, limites e proprietário. Contrato: lista devolve ID/DEK/metadados cifrados; detalhe devolve arquivo cifrado; upload é criação imutável; autorização e exclusão só pelo proprietário.
- [x] Entidade `entities/material`: cifrar/decifrar com `@limmiar/crypto`, contrato API e validação de PDF/TXT; testes de AAD, isolamento e retorno idêntico do arquivo.
- [x] Página `/acervo`: upload com título/autores/referência, processamento, erros, vazio, lista com autorização real, recuperar e excluir. Integração do motor local coordenada com agente principal e documentada com contrato exato.
- [x] `PatientCare`: carteira em pastas, busca local, pasta selecionada e navegação entre consentimentos/notas/sessões; componente de sessões preserva revisões e mostra notas avulsas separadamente. Manter bloqueio de troca durante sessão pendente.
- [x] Traduções Lingui, TypeScript, lint/arquitetura, testes focados e prova visual desktop/mobile. Registrar evidências e limitações reais sem transformar fixtures em prova de juiz clínico.
