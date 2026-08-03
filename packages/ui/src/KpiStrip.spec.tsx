import { expect, test } from '@playwright/experimental-ct-react'
import { KpiStrip } from './KpiStrip'
import { componentAxeBuilder } from './test-support/axe'
import { VISUAL_LOCALES } from './test-support/locales'

const FIXTURE_ITEMS: Record<string, { label: string; value: string }[]> = {
  'pt-BR': [
    { label: 'Pacientes ativos', value: '24' },
    { label: 'Sessões / semana', value: '18' },
    { label: 'Risco elevado', value: '3' },
    { label: 'Notas pendentes', value: '1' },
  ],
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
  })
}
