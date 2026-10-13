# Organograma do copiloto

## Visão completa

```mermaid
flowchart TD
    U[Profissional autenticado] --> S[Inicia sessão]
    S --> L[Seleciona obras]
    L --> A[API .NET autoriza sessão e acervo]
    A --> C[Cliente captura e transcreve]
    C --> E[Segmento final com locutor, idioma e tempo]
    E --> P[API do copiloto Python]
    P --> W[Estado isolado por sessionId]
    W --> G{Locutor é paciente?}
    G -- não --> N1[Silêncio]
    G -- sim --> T[Triagem local]
    T --> Q{Clínico, risco ou ambíguo?}
    Q -- não --> N2[Silêncio]
    Q -- sim --> V[Embedding BGE-M3]
    V --> R[Busca vetorial + BM25 + RRF]
    R --> X[Filtro selectedWorkIds]
    X --> J[Juiz gte-r2 em lote]
    J --> K[Escolha por limiar]
    K --> H[Proveniência no PDF]
    H --> Y{Página, parágrafo e texto conferem?}
    Y -- não --> N3[Silêncio com motivo]
    Y -- sim --> O[Cartão tipado]
    O --> D[API publica para a sessão]
    D --> TELA[Cliente renderiza destaque e fonte]
```

## Ingestão do acervo

```mermaid
flowchart LR
    P[PDF] --> H[SHA-256]
    H --> X[Extrator de página]
    X --> C[Chunker de parágrafo]
    C --> DB[(SQLite/PostgreSQL)]
    C --> E[BGE-M3]
    E --> M[Matriz vetorial]
    C --> B[BM25]
    B --> I[Índice versionado]
    DB --> T[Autoteste de proveniência]
    M --> T
    I --> T
    T --> R[Manifesto pronto]
```

## Ciclo de vida do índice

```text
PDF recebido
   ↓
obra em processamento
   ↓
trechos extraídos + páginas preservadas
   ↓
embeddings e BM25 gerados
   ↓
autotestes aprovados
   ↓
índice vN imutável
   ↓
sessões novas apontam para vN
```

Um índice não deve ser alterado enquanto uma sessão o usa. Um novo PDF gera uma nova versão; sessões existentes terminam na versão que já tinham.
