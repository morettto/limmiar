import pseudolocale from 'pseudolocale'

// ADR-S00.5-06 ("Pseudo-locale como 5º locale, só em CI"): mesma receita do
// build real do Lingui em apps/app/lingui.config.pseudo.ts — expansão de
// ~35%, acento sintético, colchetes ⟦…⟧ delimitando o texto. Aplicada aqui
// direto nas strings de fixture dos *.spec.tsx, não via catálogo Lingui:
// packages/ui não depende de Lingui/@limmiar/i18n (tradução é
// responsabilidade do app consumidor, não da primitiva de apresentação —
// ver .dependency-cruiser.cjs). `pseudolocale` é a lib genérica que o
// próprio @lingui/cli usa por baixo pra pseudolocalizar — depender dela
// direto dá saída byte-idêntica a um build real do Lingui, sem copiar a
// tabela de substituição de acento à mão.
const PSEUDO_LOCALE_OPTIONS = { extend: 0.35, prepend: '⟦', append: '⟧' } as const

export function pseudoLocalize(text: string): string {
  return pseudolocale(text, PSEUDO_LOCALE_OPTIONS)
}
