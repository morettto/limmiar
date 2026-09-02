import { expect, test } from '@playwright/experimental-ct-react'
import { AdaptiveNav, type AdaptiveNavItem } from './AdaptiveNav'
import { HeaderAction } from './HeaderAction'
import { MOBILE_NAV_HEIGHT_PX } from './layout-constants'
import { componentAxeBuilder } from './test-support/axe'
import { findOverflowViolations } from './test-support/overflow'
import { pseudoLocalize } from './test-support/pseudo-locale'
import { VISUAL_LOCALES, type VisualLocale } from './test-support/locales'

function icon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20}>
      <circle cx={12} cy={12} r={8} />
    </svg>
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// key/href/current são estrutura, não rótulo de UI — ficam constantes nas 5
// entradas; só o texto do label muda por locale.
const ITEM_META: Array<Omit<AdaptiveNavItem, 'label' | 'icon'>> = [
  { key: 'painel', href: '/painel', current: true },
  { key: 'pacientes', href: '/pacientes' },
  { key: 'sessoes', href: '/sessoes' },
  { key: 'agenda', href: '/agenda' },
  { key: 'notas', href: '/notas' },
  { key: 'cobranca', href: '/cobranca' },
  { key: 'privacidade', href: '/privacidade' },
]

const PT_BR_LABELS = ['Painel', 'Pacientes', 'Sessões', 'Agenda', 'Notas', 'Cobrança', 'Privacidade']
const PT_BR_MORE_LABEL = 'Mais'

const LABELS: Record<VisualLocale, string[]> = {
  'pt-BR': PT_BR_LABELS,
  'es-419': ['Panel', 'Pacientes', 'Sesiones', 'Agenda', 'Notas', 'Facturación', 'Privacidad'],
  'it-IT': ['Pannello', 'Pazienti', 'Sessioni', 'Agenda', 'Note', 'Fatturazione', 'Privacy'],
  'en-US': ['Dashboard', 'Patients', 'Sessions', 'Schedule', 'Notes', 'Billing', 'Privacy'],
  // Sempre derivado de pt-BR via pseudoLocalize, nunca escrito à mão.
  pseudo: PT_BR_LABELS.map((label) => pseudoLocalize(label)),
}

const MORE_LABEL: Record<VisualLocale, string> = {
  'pt-BR': PT_BR_MORE_LABEL,
  'es-419': 'Más',
  'it-IT': 'Altro',
  'en-US': 'More',
  pseudo: pseudoLocalize(PT_BR_MORE_LABEL),
}

function itemsFor(locale: VisualLocale): AdaptiveNavItem[] {
  return ITEM_META.map((meta, index) => ({ ...meta, label: LABELS[locale][index], icon: icon() }))
}

// The M bottom bar is `fixed`, positioned against the viewport and thus outside a
// component screenshot's bounding box; `transform` makes this wrapper the
// containing block for fixed descendants.
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
        <AdaptiveNav items={itemsFor(locale)} brandLabel="Limmiar" />
      </div>,
    )

    await expect(component).toHaveScreenshot(`adaptive-nav-${locale}.png`)

    const results = await componentAxeBuilder(page).analyze()
    expect(results.violations).toEqual([])

    expect(await findOverflowViolations(component)).toEqual([])
  })
}

test('T rail label drawer / M overflow menu open correctly and stay axe-clean (T-md/T-lg/M-sm only)', async ({
  mount,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'D-xl', 'D sidebar has no disclosure trigger')

  const component = await mount(
    <div style={wrapperStyle}>
      <AdaptiveNav items={itemsFor('pt-BR')} brandLabel="Limmiar" />
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
      <AdaptiveNav items={itemsFor('pt-BR')} brandLabel="Limmiar" />
    </div>,
  )

  const trigger = component.getByRole('button', { name: /Limmiar|Mais/ })
  const box = await trigger.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})

test('touch target holds 44px under pseudo-locale expansion at T/M (rail toggle / overflow trigger)', async ({
  mount,
}, testInfo) => {
  test.skip(testInfo.project.name === 'D-xl', 'AC2 (S00.5-04) is scoped to tablet/mobile')

  const component = await mount(
    <div style={wrapperStyle}>
      <AdaptiveNav items={itemsFor('pseudo')} brandLabel="Limmiar" moreLabel={MORE_LABEL.pseudo} />
    </div>,
  )

  const trigger = component.getByRole('button', { name: new RegExp(`Limmiar|${escapeRegExp(MORE_LABEL.pseudo)}`) })
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
      <AdaptiveNav items={itemsFor('pt-BR')} brandLabel="Limmiar" />
    </div>,
  )

  const box = await component.getByRole('navigation').boundingBox()
  expect(box?.height).toBe(MOBILE_NAV_HEIGHT_PX)
})

// R4's "acima da nav" composed with R1's M bottom bar (P1-M in the wireframe):
// proves stackAboveMobileNav actually clears AdaptiveNav, not just that the two
// numbers add up on paper.
test('HeaderAction with stackAboveMobileNav does not overlap AdaptiveNav at M-sm', async ({ mount }, testInfo) => {
  test.skip(testInfo.project.name !== 'M-sm', 'both primitives only stack like this at sm')

  const component = await mount(
    <div style={wrapperStyle}>
      <HeaderAction stackAboveMobileNav>Iniciar sessão</HeaderAction>
      <AdaptiveNav items={itemsFor('pt-BR')} brandLabel="Limmiar" />
    </div>,
  )

  const actionBox = await component.getByRole('button', { name: 'Iniciar sessão' }).boundingBox()
  const navBox = await component.getByRole('navigation').boundingBox()

  expect(actionBox).not.toBeNull()
  expect(navBox).not.toBeNull()
  // action's bottom edge must sit at or above nav's top edge — no overlap.
  expect((actionBox?.y ?? 0) + (actionBox?.height ?? 0)).toBeLessThanOrEqual(navBox?.y ?? 0)
})
