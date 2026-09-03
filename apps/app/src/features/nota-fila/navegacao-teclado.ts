// Seam puro (sem React, sem browser) para a navegação por teclado da fila de assinatura.
// Ver README.md deste módulo para a decisão de "para" vs. "dá a volta" nos limites.

/**
 * Índice seguinte na listbox depois de premir `tecla`: `j` desce, `k` sobe, e para nos limites
 * (não dá a volta). Lista vazia ou tecla irrelevante devolvem `indice`; sem seleção, ambos pousam
 * no primeiro item.
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
