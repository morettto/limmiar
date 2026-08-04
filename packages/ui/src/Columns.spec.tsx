import { expect, test } from '@playwright/experimental-ct-react'
import { Columns } from './Columns'
import { componentAxeBuilder } from './test-support/axe'
import { findOverflowViolations } from './test-support/overflow'
import { pseudoLocalize } from './test-support/pseudo-locale'
import { VISUAL_LOCALES, type VisualLocale } from './test-support/locales'

interface ColumnsFixture {
  contentText: string
  alertText: string
  actionText: string
  actionLabel: string
}

const PT_BR_FIXTURE: ColumnsFixture = {
  contentText: 'Agenda de hoje',
  alertText: 'Requer você · 3',
  actionText: 'Insights do Copilot',
  actionLabel: 'Insights (2)',
}

const FIXTURES: Record<VisualLocale, ColumnsFixture> = {
  'pt-BR': PT_BR_FIXTURE,
  'es-419': {
    contentText: 'Agenda de hoy',
    alertText: 'Requiere tu atención · 3',
    actionText: 'Perspectivas del Copiloto',
    actionLabel: 'Perspectivas (2)',
  },
  'it-IT': {
    contentText: 'Agenda di oggi',
    alertText: 'Richiede te · 3',
    actionText: 'Approfondimenti del Copilot',
    actionLabel: 'Approfondimenti (2)',
  },
  'en-US': {
    contentText: "Today's agenda",
    alertText: 'Requires you · 3',
    actionText: 'Copilot insights',
    actionLabel: 'Insights (2)',
  },
  // Sempre derivado de pt-BR via pseudoLocalize, nunca escrito à mão.
  pseudo: {
    contentText: pseudoLocalize(PT_BR_FIXTURE.contentText),
    alertText: pseudoLocalize(PT_BR_FIXTURE.alertText),
    actionText: pseudoLocalize(PT_BR_FIXTURE.actionText),
    actionLabel: pseudoLocalize(PT_BR_FIXTURE.actionLabel),
  },
}

function columns(fixture: ColumnsFixture) {
  return (
    <Columns
      content={<div className="rounded-md border border-neutral-300 p-3">{fixture.contentText}</div>}
      alert={<div className="rounded-md border border-neutral-300 p-3">{fixture.alertText}</div>}
      action={<div className="rounded-md border border-neutral-300 p-3">{fixture.actionText}</div>}
      actionLabel={fixture.actionLabel}
    />
  )
}

for (const locale of VISUAL_LOCALES) {
  test(`renders correctly [${locale}]`, async ({ mount, page }) => {
    const component = await mount(<div style={{ maxWidth: 900, padding: 16 }}>{columns(FIXTURES[locale])}</div>)

    await expect(component).toHaveScreenshot(`columns-${locale}.png`)

    const results = await componentAxeBuilder(page).analyze()
    expect(results.violations).toEqual([])

    expect(await findOverflowViolations(component)).toEqual([])
  })
}

test('drawer trigger meets the 44px touch target at T (T-md/T-lg only)', async ({ mount }, testInfo) => {
  test.skip(!['T-md', 'T-lg'].includes(testInfo.project.name), 'drawer trigger only renders at md/lg')

  const component = await mount(<div style={{ maxWidth: 900, padding: 16 }}>{columns(FIXTURES['pt-BR'])}</div>)
  const trigger = component.getByRole('button', { name: 'Insights (2)' })
  const box = await trigger.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})

test('drawer trigger holds the 44px touch target under pseudo-locale expansion (T-md/T-lg only)', async ({
  mount,
}, testInfo) => {
  test.skip(!['T-md', 'T-lg'].includes(testInfo.project.name), 'drawer trigger only renders at md/lg')

  const component = await mount(<div style={{ maxWidth: 900, padding: 16 }}>{columns(FIXTURES.pseudo)}</div>)
  const trigger = component.getByRole('button')
  const box = await trigger.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})

test('opening the drawer reveals the action column and stays axe-clean (T-md/T-lg only)', async ({ mount, page }, testInfo) => {
  test.skip(!['T-md', 'T-lg'].includes(testInfo.project.name), 'drawer trigger only renders at md/lg')

  const component = await mount(<div style={{ maxWidth: 900, padding: 16 }}>{columns(FIXTURES['pt-BR'])}</div>)
  await component.getByRole('button', { name: 'Insights (2)' }).click()
  await expect(component.getByText('Insights do Copilot')).toBeVisible()

  const results = await componentAxeBuilder(page).analyze()
  expect(results.violations).toEqual([])
})
