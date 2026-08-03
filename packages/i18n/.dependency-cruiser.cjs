/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-date-libraries',
      comment:
        'ADR-S00.5-03: Intl is the single source of truth for date/number formatting (same CLDR data that governs plural rules). date-fns/dayjs/moment must never enter this package.',
      severity: 'error',
      from: {},
      to: {
        path: '^(date-fns|dayjs|moment)$',
      },
    },
    {
      name: 'no-content-locale-in-plaintext-transport',
      comment:
        'D20 (S00.5-07): contentLocale must never leave the encrypted flow in the clear. The real encrypted flow (S01) and the Patient/Session entities that will carry contentLocale (S03/S05) do not exist in this repo yet, so this rule is the guardrail available today — it blocks any future telemetry/logging/analytics module from importing the branded ContentLocale type directly.',
      severity: 'error',
      from: {
        path: '(telemetry|logging|analytics)',
      },
      to: {
        path: 'content-locale',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
  },
}
