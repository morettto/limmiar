import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

// best-practice stays: withTags is a whitelist, and dropping it would silently stop the rules
// (region, landmark-one-main...) that every E2E already ran with axe's defaults.
const WCAG_22_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

// CT mounts one component with no page chrome, so these 4 axe rules check document-level structure
// that belongs to the real app shell, not to a component's own contract. Copied from packages/ui
// rather than imported: that package only exports ".", so a deep import would break the boundary.
const PAGE_LEVEL_RULES = [
  'region',
  'html-has-lang',
  'landmark-one-main',
  'page-has-heading-one',
  'document-title',
]

export function axeBuilder(page: Page) {
  return new AxeBuilder({ page }).withTags(WCAG_22_AA_TAGS)
}

export function componentAxeBuilder(page: Page) {
  return axeBuilder(page).disableRules(PAGE_LEVEL_RULES)
}
