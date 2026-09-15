import { Trans, useLingui } from '@lingui/react/macro'

// CVV primeiro no DOM (ação principal, ADR-S11-04): o 1.º Tab de qualquer ecrã de paciente foca
// este link, nunca o formulário. `<nav>` nativo, sem ARIA extra, para foco e leitor de ecrã
// virem de graça.
export function ContactoEmergencia() {
  const { t } = useLingui()
  return (
    <nav aria-label={t`Contacto de emergência`}>
      <a href="tel:188">
        <Trans>CVV 188 · apoio emocional 24 h</Trans>
      </a>
      <a href="tel:192">
        <Trans>SAMU 192</Trans>
      </a>
    </nav>
  )
}
