import { expect, test } from '@playwright/experimental-ct-react'
import { CalendarViewport } from './CalendarViewport'
import { componentAxeBuilder } from './test-support/axe'
import { findOverflowViolations } from './test-support/overflow'
import { pseudoLocalize } from './test-support/pseudo-locale'
import { VISUAL_LOCALES, type VisualLocale } from './test-support/locales'

const WEEK = Array.from({ length: 5 }, (_, i) => new Date(Date.UTC(2026, 10, 2 + i)))

interface DaySlotLabels {
  busyLabel: string
  freeLabel: string
  dayPrefix: string
}

const PT_BR_LABELS: DaySlotLabels = {
  busyLabel: '15:30 Amelia H.',
  freeLabel: 'livre',
  dayPrefix: 'dia',
}

// busyLabel é horário + nome abreviado (dado, sem palavra traduzível) — fica
// idêntico nas 4 entradas reais; freeLabel e dayPrefix são rótulo de UI de
// verdade. pseudo sempre derivado de pt-BR via pseudoLocalize, nunca escrito
// à mão (inclusive busyLabel — mesmo padrão de HeaderAction, que
// pseudolocaliza a string inteira mesmo com dado embutido).
const LABELS: Record<VisualLocale, DaySlotLabels> = {
  'pt-BR': PT_BR_LABELS,
  'es-419': { busyLabel: '15:30 Amelia H.', freeLabel: 'libre', dayPrefix: 'día' },
  'it-IT': { busyLabel: '15:30 Amelia H.', freeLabel: 'libero', dayPrefix: 'giorno' },
  'en-US': { busyLabel: '15:30 Amelia H.', freeLabel: 'free', dayPrefix: 'day' },
  pseudo: {
    busyLabel: pseudoLocalize(PT_BR_LABELS.busyLabel),
    freeLabel: pseudoLocalize(PT_BR_LABELS.freeLabel),
    dayPrefix: pseudoLocalize(PT_BR_LABELS.dayPrefix),
  },
}

// Inlined as plain DOM elements (not a local component function): Playwright
// CT's mount() can only resolve custom components that are imported from
// another module — a component declared in the test file itself fails with
// "cannot be mounted... Create a test story instead".
function daySlots(labels: DaySlotLabels) {
  return WEEK.map((day) => (
    <div key={day.toISOString()} className="flex flex-col gap-1">
      <div className="rounded-md border border-neutral-300 p-2 text-sm">{labels.busyLabel}</div>
      <div className="rounded-md border border-dashed border-neutral-300 p-2 text-sm text-neutral-400">
        {labels.freeLabel}
      </div>
      <div className="text-xs text-neutral-500">
        {labels.dayPrefix} {day.getUTCDate()}
      </div>
    </div>
  ))
}

for (const locale of VISUAL_LOCALES) {
  test(`renders correctly [${locale}]`, async ({ mount, page }) => {
    const component = await mount(
      <div style={{ maxWidth: 900, padding: 16 }}>
        <CalendarViewport days={WEEK}>{daySlots(LABELS[locale])}</CalendarViewport>
      </div>,
    )

    await expect(component).toHaveScreenshot(`calendar-viewport-${locale}.png`)

    const results = await componentAxeBuilder(page).analyze()
    expect(results.violations).toEqual([])

    expect(await findOverflowViolations(component)).toEqual([])
  })
}

// Touch target: the date selector (sm-only) must meet the 44px minimum the
// spec mandates for T/M (Wireframes - Responsivo, "Alvos e densidade").
test('date selector meets the 44px touch target on M-sm', async ({ mount }, testInfo) => {
  test.skip(testInfo.project.name !== 'M-sm', 'selector only renders below md')

  const component = await mount(
    <div style={{ maxWidth: 400, padding: 16 }}>
      <CalendarViewport days={WEEK}>{daySlots(LABELS['pt-BR'])}</CalendarViewport>
    </div>,
  )

  const select = component.getByRole('combobox')
  const box = await select.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})

test('date selector holds the 44px touch target under pseudo-locale expansion on M-sm', async ({ mount }, testInfo) => {
  test.skip(testInfo.project.name !== 'M-sm', 'selector only renders below md')

  const component = await mount(
    <div style={{ maxWidth: 400, padding: 16 }}>
      <CalendarViewport days={WEEK}>{daySlots(LABELS.pseudo)}</CalendarViewport>
    </div>,
  )

  const select = component.getByRole('combobox')
  const box = await select.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})
