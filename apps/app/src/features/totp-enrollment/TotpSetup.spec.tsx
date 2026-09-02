import { expect, test } from '@playwright/experimental-ct-react'
import { TotpSetup } from './TotpSetup'
import { CtI18nProvider } from '../../test-support/ct-i18n'
import { componentAxeBuilder } from '../../test-support/axe'

// Ticket S02-03: mandatory TOTP enrollment for AccountRole.Professional. Same CT pattern as
// AuthScreen.spec.tsx (mount, toHaveScreenshot, axe-clean) over the two screens a real professional
// sees, with the API calls intercepted via page.route.
const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
// Security-review fix: begin/confirm now require the two-factor ticket register/login/
// google issued for this account -- see api/client.ts's doc comments.
const TICKET = 'two-factor-ticket-ct'

function mountTotpSetup() {
  return (
    <CtI18nProvider>
      <TotpSetup baseUrl="http://ct.invalid" accountId={ACCOUNT_ID} ticket={TICKET} onDone={() => {}} />
    </CtI18nProvider>
  )
}

test('enrollment step: shows the secret and provisioning URI, and stays axe-clean', async ({ mount, page }) => {
  let beginRequestBody: unknown
  await page.route('**/accounts/*/totp', (route) => {
    beginRequestBody = route.request().postDataJSON()
    return route.fulfill({
      json: { secret: 'JBSWY3DPEHPK3PXP', provisioningUri: 'otpauth://totp/Limmiar:user@example.com?secret=JBSWY3DPEHPK3PXP' },
    })
  })

  const component = await mount(mountTotpSetup())

  await expect(component.getByLabel('Código secreto')).toHaveValue('JBSWY3DPEHPK3PXP')
  await expect(component).toHaveScreenshot('totp-setup-enroll.png')
  // Regression check: the ticket must actually be sent, not just accepted as a prop.
  expect(beginRequestBody).toEqual({ ticket: TICKET })

  const results = await componentAxeBuilder(page).analyze()
  expect(results.violations).toEqual([])
})

test('backup-codes step: dedicated screen, all 10 codes visible, stays axe-clean', async ({ mount, page }) => {
  await page.route('**/accounts/*/totp', (route) =>
    route.fulfill({
      json: { secret: 'JBSWY3DPEHPK3PXP', provisioningUri: 'otpauth://totp/Limmiar:user@example.com?secret=JBSWY3DPEHPK3PXP' },
    }),
  )
  const backupCodes = Array.from({ length: 10 }, (_, index) => `abcde-${index}0000`)
  let confirmRequestBody: unknown
  await page.route('**/accounts/*/totp/confirm', (route) => {
    confirmRequestBody = route.request().postDataJSON()
    return route.fulfill({ json: { backupCodes } })
  })

  const component = await mount(mountTotpSetup())
  await component.getByLabel('Código de 6 dígitos do aplicativo autenticador').fill('123456')
  await component.getByRole('button', { name: 'Confirmar' }).click()

  for (const backupCode of backupCodes) {
    await expect(component.getByText(backupCode)).toBeVisible()
  }
  await expect(component).toHaveScreenshot('totp-setup-backup-codes.png')
  // Regression check: the ticket must actually be sent, not just accepted as a prop.
  expect(confirmRequestBody).toEqual({ ticket: TICKET, code: '123456' })

  const results = await componentAxeBuilder(page).analyze()
  expect(results.violations).toEqual([])
})
