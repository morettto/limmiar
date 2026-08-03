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
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
  },
}
