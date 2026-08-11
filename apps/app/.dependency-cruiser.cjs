/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'fsd-pages-no-app',
      comment:
        'Feature-Sliced Design one-direction rule (app > pages > widgets > features > entities > shared): pages may depend on pages|widgets|features|entities|shared, never app.',
      severity: 'error',
      from: { path: '^src/pages' },
      to: { path: '^src/app' },
    },
    {
      name: 'fsd-widgets-no-app-or-pages',
      comment:
        'FSD one-direction rule: widgets may depend on widgets|features|entities|shared, never app or pages.',
      severity: 'error',
      from: { path: '^src/widgets' },
      to: { path: '^src/(app|pages)' },
    },
    {
      name: 'fsd-features-no-app-pages-widgets',
      comment:
        'FSD one-direction rule: features may depend on features|entities|shared, never app, pages, or widgets.',
      severity: 'error',
      from: { path: '^src/features' },
      to: { path: '^src/(app|pages|widgets)' },
    },
    {
      name: 'fsd-entities-no-app-pages-widgets-features',
      comment:
        'FSD one-direction rule: entities may depend on entities|shared, never app, pages, widgets, or features.',
      severity: 'error',
      from: { path: '^src/entities' },
      to: { path: '^src/(app|pages|widgets|features)' },
    },
    {
      name: 'fsd-shared-no-upper-layers',
      comment:
        'FSD one-direction rule: shared may depend on shared only, never app, pages, widgets, features, or entities.',
      severity: 'error',
      from: { path: '^src/shared' },
      to: { path: '^src/(app|pages|widgets|features|entities)' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
  },
}
