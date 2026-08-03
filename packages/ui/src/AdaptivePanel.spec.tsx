import { expect, test } from '@playwright/experimental-ct-react'
import { AdaptivePanel } from './AdaptivePanel'
import { componentAxeBuilder } from './test-support/axe'
import { VISUAL_LOCALES } from './test-support/locales'

function fixture() {
  return (
    <AdaptivePanel label="Sinais">
      <div className="text-sm">Ritmo de fala: 163 wpm</div>
      <div className="text-sm">Sentimento: ansiosa → reflexiva</div>
    </AdaptivePanel>
  )
}

for (const locale of VISUAL_LOCALES) {
  test(`renders correctly closed [${locale}]`, async ({ mount, page }) => {
    const component = await mount(
      <div style={{ maxWidth: 700, minHeight: 300, padding: 16, position: 'relative' }}>{fixture()}</div>,
    )

    await expect(component).toHaveScreenshot(`adaptive-panel-closed-${locale}.png`)

    const results = await componentAxeBuilder(page).analyze()
    expect(results.violations).toEqual([])
  })
}

test('opened drawer/strip renders correctly and stays axe-clean (T-md/T-lg/M-sm only)', async ({ mount, page }, testInfo) => {
  test.skip(testInfo.project.name === 'D-xl', 'D has no disclosure trigger — always open')

  const component = await mount(
    <div style={{ maxWidth: 700, minHeight: 300, padding: 16, position: 'relative' }}>{fixture()}</div>,
  )
  await component.getByRole('button', { name: 'Sinais' }).click()
  await expect(component).toHaveScreenshot(`adaptive-panel-open-${testInfo.project.name}.png`)

  const results = await componentAxeBuilder(page).analyze()
  expect(results.violations).toEqual([])
})

test('disclosure trigger meets the 44px touch target at T/M', async ({ mount }, testInfo) => {
  test.skip(testInfo.project.name === 'D-xl', 'D has no disclosure trigger')

  const component = await mount(
    <div style={{ maxWidth: 700, minHeight: 300, padding: 16, position: 'relative' }}>{fixture()}</div>,
  )
  const trigger = component.getByRole('button', { name: 'Sinais' })
  const box = await trigger.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})
