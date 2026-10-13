import type { Page } from '@playwright/test'

// O RP ID é "localhost" (WebAuthn__RelyingPartyId em playwright.config.ts): o IP 127.0.0.1 dos
// outros specs não serve de RP ID, então a cerimônia da passkey só corre nesta origem.
export const ORIGEM_PASSKEY = 'http://localhost:8787'

/**
 * Autenticador de plataforma do CDP, com PRF porque a KEK do paciente sai dele. Instalar só
 * depois da primeira navegação à origem real: o domínio WebAuthn do CDP liga-se ao alvo atual
 * da página, e about:blank para uma origem real troca de processo no Chromium.
 */
export async function instalarAutenticadorVirtual(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  })
}
