export type ConsentimentoVoto = 'sim' | 'nao'

export const CONSENTIMENTO_STORAGE_KEY_PREFIX = 'limmiar:voto-consentimento'

const chave = (accountId: string) => `${CONSENTIMENTO_STORAGE_KEY_PREFIX}:${accountId}`

export function lerConsentimento(accountId: string): ConsentimentoVoto | null {
  const valor = window.localStorage.getItem(chave(accountId))
  return valor === 'sim' || valor === 'nao' ? valor : null
}

export function gravarConsentimento(accountId: string, valor: ConsentimentoVoto): void {
  window.localStorage.setItem(chave(accountId), valor)
}
