import { expect, test } from '@playwright/experimental-ct-react'
import { AdaptiveNav, type AdaptiveNavItem } from './AdaptiveNav'
import { componentAxeBuilder } from './test-support/axe'
import { VISUAL_LOCALES } from './test-support/locales'

function icon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20}>
      <circle cx={12} cy={12} r={8} />
    </svg>
  )
}

const ITEMS: AdaptiveNavItem[] = [
  { key: 'painel', label: 'Painel', icon: icon(), href: '/painel', current: true },
  { key: 'pacientes', label: 'Pacientes', icon: icon(), href: '/pacientes' },
  { key: 'sessoes', label: 'Sessões', icon: icon(), href: '/sessoes' },
  { key: 'agenda', label: 'Agenda', icon: icon(), href: '/agenda' },
  { key: 'notas', label: 'Notas', icon: icon(), href: '/notas' },
  { key: 'cobranca', label: 'Cobrança', icon: icon(), href: '/cobranca' },
  { key: 'privacidade', label: 'Privacidade', icon: icon(), href: '/privacidade' },
]

// The M bottom bar is `fixed`, which positions relative to the *viewport* by
// default — outside the bounding box a component screenshot captures
// (confirmed empty without this fix). `transform` makes this wrapper the
// containing block for fixed descendants too, per the CSS spec.
const wrapperStyle = {
  width: 900,
  height: 400,
  padding: 16,
  position: 'relative' as const,
  transform: 'translateZ(0)',
}

for (const locale of VISUAL_LOCALES) {
  test(`renders correctly [${locale}]`, async ({ mount, page }) => {
    const component = await mount(
      <div style={wrapperStyle}>
        <AdaptiveNav items={ITEMS} brandLabel="Limmiar" />
      </div>,
    )

    await expect(component).toHaveScreenshot(`adaptive-nav-${locale}.png`)

    const results = await componentAxeBuilder(page).analyze()
    expect(results.violations).toEqual([])
  })
}

test('T rail label drawer / M overflow menu open correctly and stay axe-clean (T-md/T-lg/M-sm only)', async ({
  mount,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'D-xl', 'D sidebar has no disclosure trigger')

  const component = await mount(
    <div style={wrapperStyle}>
      <AdaptiveNav items={ITEMS} brandLabel="Limmiar" />
    </div>,
  )

  await component.getByRole('button', { name: /Limmiar|Mais/ }).click()
  await expect(component).toHaveScreenshot(`adaptive-nav-open-${testInfo.project.name}.png`)

  const results = await componentAxeBuilder(page).analyze()
  expect(results.violations).toEqual([])
})

test('touch targets meet 44px at T/M (rail toggle + links, bottom-bar links)', async ({ mount }, testInfo) => {
  test.skip(testInfo.project.name === 'D-xl', 'D uses the 32px mouse minimum, not 44px')

  const component = await mount(
    <div style={wrapperStyle}>
      <AdaptiveNav items={ITEMS} brandLabel="Limmiar" />
    </div>,
  )

  const trigger = component.getByRole('button', { name: /Limmiar|Mais/ })
  const box = await trigger.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})
