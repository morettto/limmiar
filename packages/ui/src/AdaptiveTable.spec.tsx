import { expect, test } from '@playwright/experimental-ct-react'
import { AdaptiveTable, type AdaptiveTableColumn, type AdaptiveTableRow } from './AdaptiveTable'
import { componentAxeBuilder } from './test-support/axe'
import { findOverflowViolations } from './test-support/overflow'
import { pseudoLocalize } from './test-support/pseudo-locale'
import { VISUAL_LOCALES, type VisualLocale } from './test-support/locales'

// Nome de paciente é dado, não rótulo de UI — fica constante nas 5 entradas.
const NAMES = ['David Okafor', 'Amelia Hartwell', 'Jonas Weber']

interface TableFixture {
  caption: string
  columnHeaders: [patient: string, risk: string, next: string, last: string]
  riskLabels: { elevated: string; moderate: string }
  nextLabels: [string, string, string]
  lastLabels: [string, string, string]
}

const PT_BR_FIXTURE: TableFixture = {
  caption: 'Pacientes',
  columnHeaders: ['Paciente', 'Risco', 'Próxima', 'Última'],
  riskLabels: { elevated: 'Elevado', moderate: 'Moderado' },
  nextLabels: ['Sex 14:30', 'Qui 10:00', 'Qua 16:00'],
  lastLabels: ['ontem', '2 dias', '5 dias'],
}

const FIXTURES: Record<VisualLocale, TableFixture> = {
  'pt-BR': PT_BR_FIXTURE,
  'es-419': {
    caption: 'Pacientes',
    columnHeaders: ['Paciente', 'Riesgo', 'Próxima', 'Última'],
    riskLabels: { elevated: 'Elevado', moderate: 'Moderado' },
    nextLabels: ['Vie 14:30', 'Jue 10:00', 'Mié 16:00'],
    lastLabels: ['ayer', '2 días', '5 días'],
  },
  'it-IT': {
    caption: 'Pazienti',
    columnHeaders: ['Paziente', 'Rischio', 'Prossima', 'Ultima'],
    riskLabels: { elevated: 'Elevato', moderate: 'Moderato' },
    nextLabels: ['Ven 14:30', 'Gio 10:00', 'Mer 16:00'],
    lastLabels: ['ieri', '2 giorni', '5 giorni'],
  },
  'en-US': {
    caption: 'Patients',
    columnHeaders: ['Patient', 'Risk', 'Next', 'Last'],
    riskLabels: { elevated: 'Elevated', moderate: 'Moderate' },
    nextLabels: ['Fri 14:30', 'Thu 10:00', 'Wed 16:00'],
    lastLabels: ['yesterday', '2 days', '5 days'],
  },
  // Sempre derivado de pt-BR via pseudoLocalize, nunca escrito à mão.
  pseudo: {
    caption: pseudoLocalize(PT_BR_FIXTURE.caption),
    columnHeaders: PT_BR_FIXTURE.columnHeaders.map((header) => pseudoLocalize(header)) as TableFixture['columnHeaders'],
    riskLabels: {
      elevated: pseudoLocalize(PT_BR_FIXTURE.riskLabels.elevated),
      moderate: pseudoLocalize(PT_BR_FIXTURE.riskLabels.moderate),
    },
    nextLabels: PT_BR_FIXTURE.nextLabels.map((label) => pseudoLocalize(label)) as TableFixture['nextLabels'],
    lastLabels: PT_BR_FIXTURE.lastLabels.map((label) => pseudoLocalize(label)) as TableFixture['lastLabels'],
  },
}

function columnsFor(fixture: TableFixture): AdaptiveTableColumn[] {
  const [patient, risk, next, last] = fixture.columnHeaders
  return [
    { key: 'name', header: patient },
    { key: 'risk', header: risk },
    { key: 'next', header: next, secondary: true },
    { key: 'last', header: last, secondary: true },
  ]
}

function rowsFor(fixture: TableFixture): AdaptiveTableRow[] {
  const { elevated, moderate } = fixture.riskLabels
  const risks = [elevated, moderate, moderate]
  return NAMES.map((name, index) => ({
    key: `p${index + 1}`,
    cells: [name, risks[index], fixture.nextLabels[index], fixture.lastLabels[index]],
  }))
}

for (const locale of VISUAL_LOCALES) {
  test(`renders correctly [${locale}]`, async ({ mount, page }) => {
    const fixture = FIXTURES[locale]
    const component = await mount(
      <div style={{ maxWidth: 700, padding: 16 }}>
        <AdaptiveTable columns={columnsFor(fixture)} rows={rowsFor(fixture)} caption={fixture.caption} />
      </div>,
    )

    await expect(component).toHaveScreenshot(`adaptive-table-${locale}.png`)

    const results = await componentAxeBuilder(page).analyze()
    expect(results.violations).toEqual([])

    expect(await findOverflowViolations(component)).toEqual([])
  })
}
