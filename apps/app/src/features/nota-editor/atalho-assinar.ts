// Seam puro (sem React, sem browser) para o atalho de teclado de assinar. Ver README.md
// deste módulo para a decisão de aceitar ⌘ OU Ctrl em vez de detetar o sistema operativo.

/**
 * `true` para o atalho de assinar: Enter com `metaKey` (⌘, Mac) OU `ctrlKey` (Ctrl, fora do
 * Mac). Aceita qualquer um dos dois em vez de detetar o sistema operativo -- ver README.
 */
export function ehAtalhoAssinar(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey)
}
