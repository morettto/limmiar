import { expect, test } from '@playwright/experimental-ct-react'
import { CalendarViewport } from './CalendarViewport'
import { componentAxeBuilder } from './test-support/axe'
import { VISUAL_LOCALES } from './test-support/locales'

const WEEK = Array.from({ length: 5 }, (_, i) => new Date(Date.UTC(2026, 10, 2 + i)))

// Inlined as plain DOM elements (not a local component function): Playwright
// CT's mount() can only resolve custom components that are imported from
// another module — a component declared in the test file itself fails with
// "cannot be mounted... Create a test story instead".
function daySlots() {
  return WEEK.map((day) => (
    <div key={day.toISOString()} className="flex flex-col gap-1">
      <div className="rounded-md border border-neutral-300 p-2 text-sm">15:30 Amelia H.</div>
      <div className="rounded-md border border-dashed border-neutral-300 p-2 text-sm text-neutral-400">livre</div>
      <div className="text-xs text-neutral-500">dia {day.getUTCDate()}</div>
    </div>
  ))
}

for (const locale of VISUAL_LOCALES) {
  test(`renders correctly [${locale}]`, async ({ mount, page }) => {
    const component = await mount(
      <div style={{ maxWidth: 900, padding: 16 }}>
        <CalendarViewport days={WEEK}>{daySlots()}</CalendarViewport>
      </div>,
    )

    await expect(component).toHaveScreenshot(`calendar-viewport-${locale}.png`)

    const results = await componentAxeBuilder(page).analyze()
    expect(results.violations).toEqual([])
  })
}

// Touch target: the date selector (sm-only) must meet the 44px minimum the
// spec mandates for T/M (Wireframes - Responsivo, "Alvos e densidade").
test('date selector meets the 44px touch target on M-sm', async ({ mount }, testInfo) => {
  test.skip(testInfo.project.name !== 'M-sm', 'selector only renders below md')

  const component = await mount(
    <div style={{ maxWidth: 400, padding: 16 }}>
      <CalendarViewport days={WEEK}>{daySlots()}</CalendarViewport>
    </div>,
  )

  const select = component.getByRole('combobox')
  const box = await select.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})
