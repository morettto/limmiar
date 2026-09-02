import pseudolocale from 'pseudolocale'

// ADR-S00.5-06: mesma receita do build real do Lingui (expansão ~35%, acento
// sintético, ⟦…⟧), aplicada às fixtures dos *.spec.tsx porque packages/ui não
// depende de Lingui. `pseudolocale` é a lib que o próprio @lingui/cli usa.
const PSEUDO_LOCALE_OPTIONS = { extend: 0.35, prepend: '⟦', append: '⟧' } as const

export function pseudoLocalize(text: string): string {
  return pseudolocale(text, PSEUDO_LOCALE_OPTIONS)
}
