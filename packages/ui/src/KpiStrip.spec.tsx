import { expect, test } from '@playwright/experimental-ct-react'
import { KpiStrip } from './KpiStrip'
import { componentAxeBuilder } from './test-support/axe'
import { findOverflowViolations } from './test-support/overflow'
import { pseudoLocalize } from './test-support/pseudo-locale'
import { VISUAL_LOCALES, type VisualLocale } from './test-support/locales'

interface KpiFixtureItem {
  label: string
  value: string
}

// value é dado (contagem), não rótulo de UI — fica constante nas 5 entradas,
// mesmo padrão dos nomes de paciente em AdaptiveTable/CalendarViewport.
const PT_BR_ITEMS: KpiFixtureItem[] = [
  { label: 'Pacientes ativos', value: '24' },
  { label: 'Sessões / semana', value: '18' },
  { label: 'Risco elevado', value: '3' },
  { label: 'Notas pendentes', value: '1' },
]

const FIXTURE_ITEMS: Record<VisualLocale, KpiFixtureItem[]> = {
  'pt-BR': PT_BR_ITEMS,
  'es-419': [
    { label: 'Pacientes activos', value: '24' },
    { label: 'Sesiones / semana', value: '18' },
    { label: 'Riesgo elevado', value: '3' },
    { label: 'Notas pendientes', value: '1' },
  ],
  'it-IT': [
    { label: 'Pazienti attivi', value: '24' },
    { label: 'Sessioni / settimana', value: '18' },
    { label: 'Rischio elevato', value: '3' },
    { label: 'Note in sospeso', value: '1' },
  ],
  'en-US': [
    { label: 'Active patients', value: '24' },
    { label: 'Sessions / week', value: '18' },
    { label: 'Elevated risk', value: '3' },
    { label: 'Pending notes', value: '1' },
  ],
  // Sempre derivado de pt-BR via pseudoLocalize, nunca escrito à mão —
  // espelha fallbackLocales: { 'pseudo-LOCALE': sourceLocale } do pipeline
  // real (apps/app/lingui.config.pseudo.ts).
  pseudo: PT_BR_ITEMS.map((item) => ({ label: pseudoLocalize(item.label), value: item.value })),
}

for (const locale of VISUAL_LOCALES) {
  test(`renders correctly [${locale}]`, async ({ mount, page }) => {
    const items = FIXTURE_ITEMS[locale]
    const component = await mount(
      <div style={{ maxWidth: 720, padding: 16 }}>
        <KpiStrip>
          {items.map((item) => (
            <KpiStrip.Item key={item.label} label={item.label} value={item.value} />
          ))}
        </KpiStrip>
      </div>,
    )

    await expect(component).toHaveScreenshot(`kpi-strip-${locale}.png`)

    const results = await componentAxeBuilder(page).analyze()
    expect(results.violations).toEqual([])

    expect(await findOverflowViolations(component)).toEqual([])
  })
}
