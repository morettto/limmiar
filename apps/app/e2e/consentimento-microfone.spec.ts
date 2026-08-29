import { test, expect } from '@playwright/test'

// S10-02 fatia 6 -- prova o portão do critério de aceite 3 ("Sem consentimento ativo, a S05
// não consegue abrir o microfone") num Chromium REAL, não em jsdom: o browser é lançado com
// --use-fake-device-for-media-stream (um microfone falso sempre disponível, sem hardware) e a
// permissão de microfone já concedida à origem (test.use({ permissions }) abaixo, sem depender
// de --use-fake-ui-for-media-stream porque a API de contexto do Playwright já contorna o
// diálogo nativo) -- ou seja, o BROWSER dava-nos o microfone se o pedíssemos. O que este teste
// prova é que o nosso código, com consentimento revogado, nunca chega a pedir: se um dia
// alguém remover o guard cedo de `abrirMicrofone` (unit-testado em microfone.test.ts, fatia 4),
// este teste apanha, porque aqui o pedido teria sucesso.
//
// A rota é o andaime de e2e '/e2e/microfone' (router.tsx, fatia 6), atrás de
// VITE_ENABLE_E2E_TEST_ROUTES -- mesmo precedente de '/devices/pair-primary'
// (device-pairing.spec.ts): o estado de consentimento chega por query string, sem UI de
// produção nenhuma por trás. O ida-e-volta ao servidor (registrar/obter consentimento) já é
// provado pelas fatias 3 e 4 (Api.Consent, entities/consentimento) -- este spec prova só o
// portão do lado do cliente.
// `launchOptions` força um novo worker/browser (Playwright só o aceita a nível de topo do
// ficheiro, não dentro de um describe) -- por isso test.use fica aqui fora, não dentro do
// describe abaixo.
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream'],
  },
})

test.describe('consentimento de gravação x microfone (S10-02)', () => {
  test('com consentimento revogado, o botão de gravar não abre o microfone', async ({ page }) => {
    await page.goto('/e2e/microfone?consentimento=revogado')

    await page.getByRole('button', { name: 'Gravar' }).click()

    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveText('consentimento-ausente')
    await expect(page.getByRole('status')).toHaveCount(0)
  })
})
