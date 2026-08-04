import { expect, test } from '@playwright/experimental-ct-react'
import { AdaptivePanel } from './AdaptivePanel'
import { componentAxeBuilder } from './test-support/axe'
import { findOverflowViolations } from './test-support/overflow'
import { pseudoLocalize } from './test-support/pseudo-locale'
import { VISUAL_LOCALES, type VisualLocale } from './test-support/locales'

interface PanelFixture {
  label: string
  signals: [string, string]
}

const PT_BR_FIXTURE: PanelFixture = {
  label: 'Sinais',
  signals: ['Ritmo de fala: 163 wpm', 'Sentimento: ansiosa → reflexiva'],
}

const FIXTURES: Record<VisualLocale, PanelFixture> = {
  'pt-BR': PT_BR_FIXTURE,
  'es-419': {
    label: 'Señales',
    signals: ['Ritmo de habla: 163 ppm', 'Sentimiento: ansiosa → reflexiva'],
  },
  'it-IT': {
    label: 'Segnali',
    signals: ['Ritmo del parlato: 163 ppm', 'Sentimento: ansiosa → riflessiva'],
  },
  'en-US': {
    label: 'Signals',
    signals: ['Speech rate: 163 wpm', 'Sentiment: anxious → reflective'],
  },
  // Sempre derivado de pt-BR via pseudoLocalize, nunca escrito à mão.
  pseudo: {
    label: pseudoLocalize(PT_BR_FIXTURE.label),
    signals: [pseudoLocalize(PT_BR_FIXTURE.signals[0]), pseudoLocalize(PT_BR_FIXTURE.signals[1])],
  },
}

function panel(fixture: PanelFixture) {
  return (
    <AdaptivePanel label={fixture.label}>
      <div className="text-sm">{fixture.signals[0]}</div>
      <div className="text-sm">{fixture.signals[1]}</div>
    </AdaptivePanel>
  )
}

for (const locale of VISUAL_LOCALES) {
  test(`renders correctly closed [${locale}]`, async ({ mount, page }) => {
    const component = await mount(
      <div style={{ maxWidth: 700, minHeight: 300, padding: 16, position: 'relative' }}>{panel(FIXTURES[locale])}</div>,
    )

    await expect(component).toHaveScreenshot(`adaptive-panel-closed-${locale}.png`)

    const results = await componentAxeBuilder(page).analyze()
    expect(results.violations).toEqual([])

    expect(await findOverflowViolations(component)).toEqual([])
  })
}

test('opened drawer/strip renders correctly and stays axe-clean (T-md/T-lg/M-sm only)', async ({ mount, page }, testInfo) => {
  test.skip(testInfo.project.name === 'D-xl', 'D has no disclosure trigger — always open')

  const component = await mount(
    <div style={{ maxWidth: 700, minHeight: 300, padding: 16, position: 'relative' }}>{panel(FIXTURES['pt-BR'])}</div>,
  )
  await component.getByRole('button', { name: 'Sinais' }).click()
  await expect(component).toHaveScreenshot(`adaptive-panel-open-${testInfo.project.name}.png`)

  const results = await componentAxeBuilder(page).analyze()
  expect(results.violations).toEqual([])
})

test('disclosure trigger meets the 44px touch target at T/M', async ({ mount }, testInfo) => {
  test.skip(testInfo.project.name === 'D-xl', 'D has no disclosure trigger')

  const component = await mount(
    <div style={{ maxWidth: 700, minHeight: 300, padding: 16, position: 'relative' }}>{panel(FIXTURES['pt-BR'])}</div>,
  )
  const trigger = component.getByRole('button', { name: 'Sinais' })
  const box = await trigger.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})

test('disclosure trigger holds the 44px touch target under pseudo-locale expansion (T/M)', async ({ mount }, testInfo) => {
  test.skip(testInfo.project.name === 'D-xl', 'AC2 (S00.5-04) is scoped to tablet/mobile')

  const component = await mount(
    <div style={{ maxWidth: 700, minHeight: 300, padding: 16, position: 'relative' }}>{panel(FIXTURES.pseudo)}</div>,
  )
  const trigger = component.getByRole('button')
  const box = await trigger.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})
