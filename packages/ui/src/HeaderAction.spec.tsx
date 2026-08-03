import { expect, test } from '@playwright/experimental-ct-react'
import { HeaderAction } from './HeaderAction'
import { componentAxeBuilder } from './test-support/axe'
import { VISUAL_LOCALES } from './test-support/locales'

for (const locale of VISUAL_LOCALES) {
  test(`renders correctly [${locale}]`, async ({ mount, page }) => {
    const component = await mount(
      <div
        style={{
          maxWidth: 900,
          minHeight: 200,
          padding: 16,
          position: 'relative',
          // At sm the button is `fixed`, which positions relative to the
          // *viewport* by default — outside the bounding box a component
          // screenshot captures (confirmed empty without this: the fixed
          // button rendered at the real viewport's bottom, past this div's
          // own 200px height). `transform` makes this div the containing
          // block for fixed descendants too, per the CSS spec.
          transform: 'translateZ(0)',
        }}
      >
        <HeaderAction>Iniciar: Amelia 15:30</HeaderAction>
      </div>,
    )

    await expect(component).toHaveScreenshot(`header-action-${locale}.png`)

    const results = await componentAxeBuilder(page).analyze()
    expect(results.violations).toEqual([])
  })
}

test('meets the touch/mouse target minimum at every breakpoint (48px sm, 44px T, 32px D)', async ({ mount }, testInfo) => {
  const component = await mount(
    <div style={{ maxWidth: 900, minHeight: 200, padding: 16, position: 'relative', transform: 'translateZ(0)' }}>
      <HeaderAction>Assinar</HeaderAction>
    </div>,
  )

  const button = component.getByRole('button', { name: 'Assinar' })
  const box = await button.boundingBox()

  const minHeight: Record<string, number> = { 'D-xl': 32, 'T-lg': 44, 'T-md': 44, 'M-sm': 48 }
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(minHeight[testInfo.project.name])
})
