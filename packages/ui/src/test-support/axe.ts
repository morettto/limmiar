import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

// Component Testing mounts one primitive at a time with no surrounding page
// chrome — no <html lang>, no <main>, no <h1>. These 4 axe rules check
// *document*-level structure (one main landmark, a lang attribute, a level-1
// heading, all content inside a landmark) that belongs to the real screens
// these primitives get composed into later (S02+), not to a primitive's own
// accessibility contract — they're false positives at this scope.
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
