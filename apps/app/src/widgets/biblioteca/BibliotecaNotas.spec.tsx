import { expect, test } from '@playwright/experimental-ct-react'
import { BibliotecaNotas } from './BibliotecaNotas'
import { CtI18nProvider } from '../../test-support/ct-i18n'
import { componentAxeBuilder } from '../../test-support/axe'
import { ESTADO_ASSINADA, ESTADO_PENDENTE } from '../../entities/nota/nota'
import type { GrupoPaciente } from '../../features/nota-biblioteca/biblioteca'

// Ticket S08-02, fatia 4, critério de aceite 5 ("axe limpo"). Sem `toHaveScreenshot`: não
// pedido pelo ticket, e regressão visual é scope à parte (ver AuthScreen.spec.tsx).

// Anotado: sem tipo contextual, o literal alarga para `string` -- acontece em qualquer
// posição de objeto/array, com um item tal como com dez.
const GRUPOS: readonly GrupoPaciente[] = [
  {
    patientId: 'paciente-1',
    itens: [
      { id: 'nota-1', patientId: 'paciente-1', estado: ESTADO_PENDENTE, revisao: 0, frases: [] },
      { id: 'nota-2', patientId: 'paciente-1', estado: ESTADO_ASSINADA, revisao: 0, frases: [] },
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
