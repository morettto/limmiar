import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

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

export function componentAxeBuilder(page: Page) {
  return new AxeBuilder({ page }).disableRules(PAGE_LEVEL_RULES)
}
