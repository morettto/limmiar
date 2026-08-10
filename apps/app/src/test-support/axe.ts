import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

// Component Testing mounts one component at a time with no surrounding page
// chrome -- no <html lang>, no <main>, no <h1>. These 4 axe rules check
// *document*-level structure (one main landmark, a lang attribute, a level-1
// heading, all content inside a landmark) that belongs to the real app shell
// AuthScreen gets composed into (App.tsx's <RouterProvider>), not to
// AuthScreen's own accessibility contract at this scope -- they're false
// positives here. Copied verbatim from packages/ui/src/test-support/axe.ts
// (S00-03) rather than imported: that package's package.json only exports
// "." (see .dependency-cruiser.cjs), so a deep import would break the
// declared package boundary.
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
