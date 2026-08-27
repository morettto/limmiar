import { expect, test } from '@playwright/experimental-ct-react'
import { AuthScreen } from './AuthScreen'
import { CtI18nProvider } from '../../test-support/ct-i18n'
import { componentAxeBuilder } from '../../test-support/axe'

// Ticket S02-01, Tela A1, AC "A1 verde nos 4 breakpoints com axe
// bloqueante". Breakpoint coverage comes for free from
// playwright-ct.config.ts's 4 projects (D-xl/T-lg/T-md/M-sm) -- each test
// below runs once per project. Structure mirrors
// packages/ui/src/AdaptivePanel.spec.tsx (S00-03): mount, toHaveScreenshot,
// componentAxeBuilder(page).analyze() with a zero-violations assertion.
//
// getGoogleIdToken is a required prop (see AuthScreen.tsx's doc comment: no
// pre-agreed Google Identity Services integration yet) -- stubbed here since
// nothing in these tests clicks the Google button.
function mountAuthScreen() {
  return (
    <CtI18nProvider>
      <AuthScreen baseUrl="http://ct.invalid" getGoogleIdToken={() => Promise.resolve('stub-id-token')} />
    </CtI18nProvider>
  )
}

test('renders correctly with the default (Profissional) segment selected', async ({ mount, page }) => {
  const component = await mount(mountAuthScreen())

  await expect(component).toHaveScreenshot('auth-screen-default.png')

  const results = await componentAxeBuilder(page).analyze()
  expect(results.violations).toEqual([])
})

test('switching to Paciente re-renders correctly and stays axe-clean', async ({ mount, page }) => {
  const component = await mount(mountAuthScreen())

  await component.getByRole('radio', { name: 'Paciente' }).click()
  await expect(component).toHaveScreenshot('auth-screen-paciente.png')

  const results = await componentAxeBuilder(page).analyze()
  expect(results.violations).toEqual([])
})
