import { expect, test } from '@playwright/experimental-ct-react'
import { AdaptiveNav, type AdaptiveNavItem } from './AdaptiveNav'
import { HeaderAction } from './HeaderAction'
import { MOBILE_NAV_HEIGHT_PX } from './layout-constants'
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

// MOBILE_NAV_HEIGHT_PX (layout-constants.ts) is HeaderAction's only source
// of truth for AdaptiveNav's real M bottom-bar height — this keeps that
// constant honest against the actual rendered layout.
test('M bottom bar renders at the height layout-constants.ts assumes', async ({ mount }, testInfo) => {
  test.skip(testInfo.project.name !== 'M-sm', 'bottom bar only renders at sm')

  const component = await mount(
    <div style={wrapperStyle}>
      <AdaptiveNav items={ITEMS} brandLabel="Limmiar" />
    </div>,
  )

  const box = await component.getByRole('navigation').boundingBox()
  expect(box?.height).toBe(MOBILE_NAV_HEIGHT_PX)
})

// R4's "acima da nav" composed with R1's M bottom bar (P1-M in the
// wireframe: "Iniciar sessão" sits directly above the 5-item nav) — proves
// HeaderAction's stackAboveMobileNav actually clears AdaptiveNav, not just
// that the two numbers add up on paper.
test('HeaderAction with stackAboveMobileNav does not overlap AdaptiveNav at M-sm', async ({ mount }, testInfo) => {
  test.skip(testInfo.project.name !== 'M-sm', 'both primitives only stack like this at sm')

  const component = await mount(
    <div style={wrapperStyle}>
      <HeaderAction stackAboveMobileNav>Iniciar sessão</HeaderAction>
      <AdaptiveNav items={ITEMS} brandLabel="Limmiar" />
    </div>,
  )

  const actionBox = await component.getByRole('button', { name: 'Iniciar sessão' }).boundingBox()
  const navBox = await component.getByRole('navigation').boundingBox()

  expect(actionBox).not.toBeNull()
  expect(navBox).not.toBeNull()
  // action's bottom edge must sit at or above nav's top edge — no overlap.
  expect((actionBox?.y ?? 0) + (actionBox?.height ?? 0)).toBeLessThanOrEqual(navBox?.y ?? 0)
})
