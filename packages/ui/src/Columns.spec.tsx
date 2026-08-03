import { expect, test } from '@playwright/experimental-ct-react'
import { Columns } from './Columns'
import { componentAxeBuilder } from './test-support/axe'
import { VISUAL_LOCALES } from './test-support/locales'

function fixture() {
  return (
    <Columns
      content={<div className="rounded-md border border-neutral-300 p-3">Agenda de hoje</div>}
      alert={<div className="rounded-md border border-neutral-300 p-3">Requer você · 3</div>}
      action={<div className="rounded-md border border-neutral-300 p-3">Insights do Copilot</div>}
      actionLabel="Insights (2)"
    />
  )
}

for (const locale of VISUAL_LOCALES) {
  test(`renders correctly [${locale}]`, async ({ mount, page }) => {
    const component = await mount(<div style={{ maxWidth: 900, padding: 16 }}>{fixture()}</div>)

    await expect(component).toHaveScreenshot(`columns-${locale}.png`)

    const results = await componentAxeBuilder(page).analyze()
    expect(results.violations).toEqual([])
  })
}

test('drawer trigger meets the 44px touch target at T (T-md/T-lg only)', async ({ mount }, testInfo) => {
  test.skip(!['T-md', 'T-lg'].includes(testInfo.project.name), 'drawer trigger only renders at md/lg')

  const component = await mount(<div style={{ maxWidth: 900, padding: 16 }}>{fixture()}</div>)
  const trigger = component.getByRole('button', { name: 'Insights (2)' })
  const box = await trigger.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})

test('opening the drawer reveals the action column and stays axe-clean (T-md/T-lg only)', async ({ mount, page }, testInfo) => {
  test.skip(!['T-md', 'T-lg'].includes(testInfo.project.name), 'drawer trigger only renders at md/lg')

  const component = await mount(<div style={{ maxWidth: 900, padding: 16 }}>{fixture()}</div>)
  await component.getByRole('button', { name: 'Insights (2)' }).click()
  await expect(component.getByText('Insights do Copilot')).toBeVisible()

  const results = await componentAxeBuilder(page).analyze()
  expect(results.violations).toEqual([])
})
