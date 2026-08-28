// Seam puro (sem React, sem browser) para a navegação por teclado da fila de assinatura.
// Ver README.md deste módulo para a decisão de "para" vs. "dá a volta" nos limites, e a
// decisão de aceitar ⌘ OU Ctrl em vez de detetar o sistema operativo.

/**
 * Índice seguinte na listbox depois de premir `tecla`. `j` desce, `k` sobe.
 * Para nos limites (não dá a volta) -- ver README. Lista vazia (`total === 0`) ou tecla
 * irrelevante devolvem `indice` inalterado. Sem seleção (`indice === -1`), `j`/`k` pousam
 * ambos no primeiro item.
 */
export function proximoIndice(indice: number, total: number, tecla: string): number {
  if (total === 0) {
    return indice
  }
  if (tecla === 'j') {
    return Math.min(indice + 1, total - 1)
  }
  if (tecla === 'k') {
    return Math.max(indice - 1, 0)
  }
  return indice
}

/**
 * `true` para o atalho de assinar: Enter com `metaKey` (⌘, Mac) OU `ctrlKey` (Ctrl, fora do
 * Mac). Aceita qualquer um dos dois em vez de detetar o sistema operativo -- ver README.
 */
export function ehAtalhoAssinar(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey)
}
