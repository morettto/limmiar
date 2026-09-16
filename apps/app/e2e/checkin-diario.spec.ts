import { test, expect } from '@playwright/test'
import { componentAxeBuilder } from '../src/test-support/axe'

// S11-01: prova os 3 critérios de aceite num Chromium real, sem API nem conta no servidor --
// '/e2e/paciente-hoje' (andaime atrás de VITE_ENABLE_E2E_TEST_ROUTES) semeia accountId/kek pela
// query string, mesmo precedente de pairPrimaryRoute.

test.describe('check-in diário de 10 segundos (S11-01)', () => {
  test.use({ locale: 'pt-BR' })

  test('3 toques, zero pedidos de rede, emergência acessível por teclado, série com lacuna', async ({ page }) => {
    const accountId = crypto.randomUUID()
    const kek = Buffer.from(new Uint8Array(32).fill(3)).toString('base64')
    const marcador = crypto.randomUUID()

    const requests: string[] = []
    page.on('request', (request) => {
      requests.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`)
    })
    // Qualquer pedido de rede que carregue a frase marcador falha o teste -- prova que nada do
    // check-in (nem a frase opcional) atravessa a rede, em nenhum momento depois do goto.
    await page.route('**/*', async (route) => {
      const request = route.request()
      const carga = `${request.url()} ${request.postData() ?? ''}`
      if (carga.includes(marcador)) {
        await route.abort()
        throw new Error(`pedido de rede vazou o marcador: ${carga}`)
      }
      await route.continue()
    })

    await page.goto(`/e2e/paciente-hoje?accountId=${accountId}&kek=${encodeURIComponent(kek)}`)
    await page.getByRole('navigation', { name: 'Contacto de emergência' }).waitFor()

    // Teclado: o 1.º Tab foca o link de emergência (CVV), ação principal (ADR-S11-04).
    await page.keyboard.press('Tab')
    const cvvLink = page.getByRole('link', { name: /CVV 188/ })
    await expect(cvvLink).toBeFocused()
    await expect(cvvLink).toHaveAttribute('href', 'tel:188')
    await expect(page.getByRole('link', { name: 'SAMU 192' })).toHaveAttribute('href', 'tel:192')

    const requestsAntesDoPrimeiroToque = requests.length

    // Exatamente 3 ações: sono, ansiedade, guardar (a frase fica fora da contagem).
    await page.getByRole('group', { name: 'Sono' }).getByRole('radio', { name: '3' }).check()
    await page.getByRole('group', { name: 'Ansiedade' }).getByRole('radio', { name: '2' }).check()
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByRole('status')).toHaveText('Guardado')

    expect(requests.slice(requestsAntesDoPrimeiroToque)).toEqual([])

    const rawSemFrase = await page.evaluate((id) => window.localStorage.getItem(`limmiar:checkin:${id}`), accountId)
    expect(rawSemFrase).not.toBeNull()
    expect(rawSemFrase).not.toContain('sono')

    // 2.º run: substitui o check-in de hoje, desta vez com a frase marcador -- prova que ela
    // também nunca aparece em claro no storage nem em nenhum pedido de rede.
    await page.getByLabel('Uma frase (opcional)').fill(marcador)
    await page.getByRole('group', { name: 'Sono' }).getByRole('radio', { name: '4' }).check()
    await page.getByRole('group', { name: 'Ansiedade' }).getByRole('radio', { name: '1' }).check()
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByRole('status')).toHaveText('Guardado')

    const rawComFrase = await page.evaluate((id) => window.localStorage.getItem(`limmiar:checkin:${id}`), accountId)
    expect(rawComFrase).not.toContain(marcador)

    await page.reload()
    await expect(page.getByRole('listitem').last()).toContainText('4/1')
    const itens = await page.getByRole('listitem').allTextContents()
    expect(itens.at(-1)).toContain('4/1')
    expect(itens.at(-2)).toContain('sem registo')

    expect((await componentAxeBuilder(page).analyze()).violations).toEqual([])
  })
})
