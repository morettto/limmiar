import type { Page } from '@playwright/test'

// O build do E2E (wrangler) não tem o proxy /copiloto do Vite: o teste repassa as chamadas ao copiloto real, que
// autoriza cada uma na API do produto com o token do profissional, como em produção.

export const COPILOTO_URL = process.env.COPILOTO_REAL_URL ?? 'http://127.0.0.1:8000'

export interface Consulta {
  frase: string
  enviadaEm: number
  respondidaEm: number
  status: number
  resposta: Record<string, unknown> | null
}

export async function rotearCopiloto(page: Page, consultas: Consulta[] = []): Promise<Consulta[]> {
  await page.route('**/copiloto/**', async (route) => {
    const pedido = route.request()
    const url = new URL(pedido.url())
    const alvo = COPILOTO_URL + url.pathname.replace(/^\/copiloto/, '') + url.search
    const enviadaEm = Date.now()
    const resposta = await route.fetch({ url: alvo, timeout: 0 }).catch(() => null)
    if (resposta === null) {
      // copiloto fora do ar: o app recebe a mesma falha de rede que teria em produção
      if (url.pathname.endsWith('/consultar-qualificado')) {
        consultas.push({ frase: (JSON.parse(pedido.postData() ?? '{}') as { frase?: string }).frase ?? '', enviadaEm,
          respondidaEm: Date.now(), status: 0, resposta: null })
      }
      await route.abort('connectionrefused')
      return
    }
    const corpo = await resposta.text()
    if (url.pathname.endsWith('/consultar-qualificado')) {
      const primeira = corpo.split('\n')[0] ?? ''
      consultas.push({
        frase: (JSON.parse(pedido.postData() ?? '{}') as { frase?: string }).frase ?? '', enviadaEm, respondidaEm: Date.now(),
        status: resposta.status(), resposta: primeira.startsWith('{') ? JSON.parse(primeira) as Record<string, unknown> : null,
      })
    }
    await route.fulfill({ response: resposta, body: corpo })
  })
  return consultas
}
