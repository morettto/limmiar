import { expect, test } from '@playwright/experimental-ct-react'
import { AdaptiveTable } from './AdaptiveTable'
import { componentAxeBuilder } from './test-support/axe'
import { VISUAL_LOCALES } from './test-support/locales'

const COLUMNS = [
  { key: 'name', header: 'Paciente' },
  { key: 'risk', header: 'Risco' },
  { key: 'next', header: 'Próxima', secondary: true },
  { key: 'last', header: 'Última', secondary: true },
]

const ROWS = [
  { key: 'p1', cells: ['David Okafor', 'Elevado', 'Sex 14:30', 'ontem'] },
  { key: 'p2', cells: ['Amelia Hartwell', 'Moderado', 'Qui 10:00', '2 dias'] },
  { key: 'p3', cells: ['Jonas Weber', 'Moderado', 'Qua 16:00', '5 dias'] },
]

for (const locale of VISUAL_LOCALES) {
  test(`renders correctly [${locale}]`, async ({ mount, page }) => {
    const component = await mount(
      <div style={{ maxWidth: 700, padding: 16 }}>
        <AdaptiveTable columns={COLUMNS} rows={ROWS} caption="Pacientes" />
      </div>,
    )

    await expect(component).toHaveScreenshot(`adaptive-table-${locale}.png`)

    const results = await componentAxeBuilder(page).analyze()
    expect(results.violations).toEqual([])
  })
}
