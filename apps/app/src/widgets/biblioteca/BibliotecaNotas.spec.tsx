import { expect, test } from '@playwright/experimental-ct-react'
import { BibliotecaNotas } from './BibliotecaNotas'
import { CtI18nProvider } from '../../test-support/ct-i18n'
import { componentAxeBuilder } from '../../test-support/axe'

// Ticket S08-02, fatia 4, critério de aceite 5 ("axe limpo"). Sem `toHaveScreenshot`: não
// pedido pelo ticket, e regressão visual é scope à parte (ver AuthScreen.spec.tsx).
const GRUPOS = [
  {
    patientId: 'paciente-1',
    itens: [
      { id: 'nota-1', patientId: 'paciente-1', estado: 'pendente' as const, revisao: 0, frases: [] },
      { id: 'nota-2', patientId: 'paciente-1', estado: 'assinada' as const, revisao: 0, frases: [] },
    ],
  },
]

function mountBiblioteca() {
  return (
    <CtI18nProvider>
      <BibliotecaNotas grupos={GRUPOS} termo="" onTermoChange={() => {}} resultado={{ estado: 'ocioso' }} />
    </CtI18nProvider>
  )
}

test('biblioteca com grupos visíveis fica axe-clean', async ({ mount, page }) => {
  await mount(mountBiblioteca())

  const results = await componentAxeBuilder(page).analyze()
  expect(results.violations).toEqual([])
})
