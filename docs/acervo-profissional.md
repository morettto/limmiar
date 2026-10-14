# Consultório e acervo pessoal

O consultório apresenta uma pasta por paciente da carteira profissional. Cada sessão corresponde ao ID de uma transcrição e contém suas revisões, falas, papéis e notas associadas explicitamente. A data serve como informação de apresentação. Uma nota independente pode ser associada ou desassociada antes da assinatura; a relação é uma entrada cifrada `nota-sessao` no prontuário. `transcriptId: null` retira a associação e preserva as entradas anteriores. Os bloqueios existentes de troca durante chamada, processamento ou correção pendente continuam aplicados.

O acervo pessoal em `/acervo` guarda PDF com texto selecionável e TXT UTF-8, até 20 MiB. A Biblioteca de notas continua dedicada às notas dos prontuários. Adicionar uma obra não autoriza sua consulta e não comprova qualificação clínica. Título e autores só são liberados depois de escolhido o arquivo: o navegador os preenche a partir do XMP ou do dicionário Info do PDF (ou do nome do arquivo) e nada sai do dispositivo antes da cifragem; a edição nunca é preenchida.

## Persistência e autorização

Cada material tem uma DEK própria, envolvida pela KEK que permanece em RAM. Metadados bibliográficos e bytes do arquivo são cifrados separadamente com AES-GCM. A AAD vincula conta, material e finalidade; o SHA-256 dos bytes originais fica nos metadados cifrados, junto com título, autores, referência, nome do arquivo, tipo e tamanho. O PostgreSQL armazena somente essas cifras, a DEK envolvida, IDs, autorização e data de criação.

Todas as rotas da API exigem bearer do proprietário e profissional ativo. A tabela `professional_materials` usa RLS por carteira profissional; nenhuma rota recebe nome de paciente.

| Método e rota | Corpo / resultado |
| --- | --- |
| `POST /accounts/{accountId}/materials` | `{materialId, wrappedDek, metadataCiphertext, contentCiphertext}`; bytes em base64; criação imutável; autorização começa falsa |
| `GET /accounts/{accountId}/materials` | `{materials: [{materialId, wrappedDek, metadataCiphertext, authorized, createdAt}]}` |
| `GET /accounts/{accountId}/materials/{materialId}/content` | `{contentCiphertext}` em base64 |
| `PUT /accounts/{accountId}/materials/{materialId}/authorization` | `{authorized: boolean}` |
| `DELETE /accounts/{accountId}/materials/{materialId}` | Exclui o material cifrado do proprietário |

## Serviço local

O navegador decifra um material autorizado em RAM, compara seu SHA-256 e envia apenas ao serviço local pelo proxy `/copiloto`. O motor consulta a lista atual da API em endereço fixo `http://127.0.0.1:5259`, com bearer exclusivamente no header. Profissional inativo, proprietário divergente, falta de autorização ou API indisponível impedem o uso.

| Método e rota local | Corpo / resultado |
| --- | --- |
| `POST /copiloto/api/acervo/{accountId}/{materialId}/preparar` | Multipart `file`, `titulo`, `autores`, `tipo=pdf\|txt`, `sha256`; retorna `{materialId, ready:true, sha256, paragraphs, preparedAt}` |
| `GET /copiloto/api/acervo/{accountId}` | `{materials: [{materialId, ready:true, sha256, paragraphs, preparedAt}]}`, reconciliados com a autorização atual |
| `DELETE /copiloto/api/acervo/{accountId}/{materialId}` | Remove a representação de RAM; 204, inclusive após exclusão/desautorização na API, para profissional ativo autenticado |

O multipart é processado com `python-multipart` diretamente do stream em RAM, sem `UploadFile` e sem arquivo temporário. PDF usa `PdfReader(BytesIO(...))`; os índices SQLite usam `:memory:` e `temp_store=memory`. Texto, páginas e embeddings privados ficam separados por `accountId`, sem gravação no corpus bibliográfico global. O preparo preserva todo o texto extraído; trechos longos são divididos em blocos de até 1200 caracteres.

Após reiniciar o motor, o estado preparado desaparece. Ao abrir um paciente com análise autorizada, `prepareAuthorizedMaterials` recupera cifras da API, decifra em RAM, valida o hash e reconstrói o acervo local. O estado da seleção vem da autorização persistida na API, cruzada com ID/hash do preparo real; não há lista privada em localStorage, IndexedDB ou OPFS. Uma falha de preparo aparece como pendência e não recebe estado pronto.

## Insights

`SessionReview` passa `{accountId, accessToken, materialIds}` a `LiveInsights`. `consultarInsight` envia o bearer no header e IDs opacos no corpo de `POST /copiloto/api/consultar-qualificado`. O motor usa somente o snapshot dos materiais privados autorizados selecionados e mantém o portão de qualificação independente do juiz. Preparo de material nunca libera um juiz sem qualificação.

Cada citação privada passa pelo mesmo juiz e pela validação literal de texto/página contra a obra em RAM. A continuação vincula consulta, configuração, IDs, hashes e modelo de busca. Autorização e qualificação são verificadas antes e depois da inferência; revogação ou indisponibilidade interrompem a resposta. As rotas públicas de pesquisa não aceitam materiais pessoais e não expõem upload, reindexação ou exclusão sem autenticação.

## Verificação

As fixtures são textos, PDFs e pacientes sintéticos. Os testes de produto não constituem qualificação clínica do juiz.

- Frontend: entidades de material, página de acervo, pastas/sessões, troca protegida, associação cifrada, integração dos insights e recuperação após perda de RAM. `pnpm exec vitest run --maxWorkers=2 --coverage` em `apps/app`.
- API: `MaterialEndpointsTests`, incluindo roundtrip AES-GCM e bytes persistidos no PostgreSQL sem bibliografia/conteúdo claros; isolamento RLS e token, limites, autorização, revogação e exclusão. Executar em Release para preservar o runtime Debug.
- Motor: `.venv/Scripts/python.exe -m unittest scripts.test_acervo_profissional scripts.test_continuacao scripts.test_citacoes scripts.test_metadados` em `mvp-copiloto`.
- Prova real e imagens desktop/mobile ficam em `.local/acervo-profissional-results`, separadas das fixtures e das provas do juiz.

Em 04/10/2026, a prova final deste escopo passou 173 testes em 12 arquivos, com 100% nas quatro métricas por arquivo (`.local/acervo-foco-final.log` e `.local/acervo-coverage-final`). Build de produção, TypeScript, arquitetura e compilação estrita dos quatro idiomas passaram. Os contadores incluem zero explícito, singular e plural. Os 51 testes focados do motor passaram (`.local/acervo-python-final.log`), incluindo 10 novos do acervo. A API passou a suíte de 882 testes com 100% de linhas/ramos/métodos na execução coordenada do agente principal (`.local/account-material-completo.log`). A suíte completa do aplicativo é coordenada junto das alterações simultâneas da agenda.

A prova Playwright real passou em `.local/acervo-e2e.log`, com resumo sem credenciais em `.local/acervo-e2e-prova.json`: upload cifrado, preparo real, arquivo recuperado idêntico, reconstrução a partir das cifras após remoção de RAM, isolamento 401/403, desautorização e exclusão. Desktop e celular passaram Axe, sem transbordamento horizontal ou erros de navegador. Vazio, erro de arquivo, processamento, pronto, confirmação de exclusão e pastas com revisões têm capturas. As fixtures próprias dos materiais foram excluídas pela interface depois da prova. O juiz continuou bloqueado por falta de qualificação independente.
