import type { I18n, MessageDescriptor } from '@lingui/core'

// Estado de tela guarda o descritor (ou o texto já pronto de um Error), nunca o `t` resolvido:
// assim a mensagem acompanha a troca de idioma sem que o efeito que a produziu precise rodar de novo.
export type Texto = string | MessageDescriptor

export function traduzir(i18n: I18n, texto: Texto): string {
  return typeof texto === 'string' ? texto : i18n._(texto)
}
