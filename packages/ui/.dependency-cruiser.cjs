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
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
  },
}
