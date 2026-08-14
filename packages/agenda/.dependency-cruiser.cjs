/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-second-timezone-library',
      comment:
        'ADR-S04-01: @date-fns/tz (the date-fns team\'s own TZDate, used for wall-clock materialization) is the only library allowed to resolve time zones in this package. luxon/dayjs/moment/moment-timezone must never enter it — a second, unrelated time zone engine alongside date-fns would duplicate DST/offset logic and risk the two disagreeing.',
      severity: 'error',
      from: {},
      to: {
        path: '^(luxon|dayjs|moment|moment-timezone)$',
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
