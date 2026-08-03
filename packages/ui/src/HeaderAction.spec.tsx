import { expect, test } from '@playwright/experimental-ct-react'
import { HeaderAction } from './HeaderAction'
import { componentAxeBuilder } from './test-support/axe'
import { findOverflowViolations } from './test-support/overflow'
import { pseudoLocalize } from './test-support/pseudo-locale'
import { VISUAL_LOCALES, type VisualLocale } from './test-support/locales'

const PT_BR_HEADER_TEXT = 'Iniciar: Amelia 15:30'

// Nome de paciente e horário são dado, não rótulo de UI — só o verbo
// inicial traduz nas 4 entradas reais.
const HEADER_TEXT: Record<VisualLocale, string> = {
  'pt-BR': PT_BR_HEADER_TEXT,
  'es-419': 'Empezar: Amelia 15:30',
  'it-IT': 'Inizia: Amelia 15:30',
  'en-US': 'Start: Amelia 15:30',
  pseudo: pseudoLocalize(PT_BR_HEADER_TEXT),
}

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
        <HeaderAction>{HEADER_TEXT[locale]}</HeaderAction>
      </div>,
    )

    await expect(component).toHaveScreenshot(`header-action-${locale}.png`)

    const results = await componentAxeBuilder(page).analyze()
    expect(results.violations).toEqual([])

    expect(await findOverflowViolations(component)).toEqual([])
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

test('holds the touch target minimum under pseudo-locale expansion at T/M (44px T, 48px M)', async ({ mount }, testInfo) => {
  test.skip(testInfo.project.name === 'D-xl', 'AC2 (S00.5-04) is scoped to tablet/mobile')

  const component = await mount(
    <div style={{ maxWidth: 900, minHeight: 200, padding: 16, position: 'relative', transform: 'translateZ(0)' }}>
      <HeaderAction>{pseudoLocalize('Assinar')}</HeaderAction>
    </div>,
  )

  const button = component.getByRole('button')
  const box = await button.boundingBox()

  const minHeight: Record<string, number> = { 'T-lg': 44, 'T-md': 44, 'M-sm': 48 }
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(minHeight[testInfo.project.name])
})
