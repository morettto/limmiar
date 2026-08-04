/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-date-libraries',
      comment:
        'ADR-S00.5-03 (packages/i18n): Intl is the single source of truth for date/number formatting. CalendarViewport formats dates directly (default formatDayLabel), so the same guardrail extends here — date-fns/dayjs/moment must never enter this package.',
      severity: 'error',
      from: {},
      to: {
        path: '^(date-fns|dayjs|moment)$',
      },
    },
    {
      name: 'no-i18n-runtime-in-ui-primitives',
      comment:
        "S00.5-04's whole design depends on packages/ui never gaining a Lingui/catalog runtime dependency — the 7 primitives take plain hardcoded strings as props; translation is the consuming app's job. Locks that boundary in for future contributors. test-support/pseudo-locale.ts's own dependency on the generic `pseudolocale` package is unrelated to Lingui/i18n and is not covered by this rule.",
      severity: 'error',
      from: { path: '^src' },
      to: { path: '^(@lingui/|@limmiar/i18n)' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
  },
}
