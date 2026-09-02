import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

// CT mounts one primitive with no page chrome, so these 4 axe rules check
// document-level structure (main landmark, lang, h1, content in a landmark) that
// belongs to the real screens (S02+) — false positives at this scope.
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
