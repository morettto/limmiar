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
    {
      name: 'fsd-no-cross-slice',
      comment:
        'FSD slice isolation: a slice depends on lower layers, never on a sibling slice of its own layer. Invariant: every file lives inside a named slice folder (no loose files at a layer root) -- not checked by this regex, verified by hand across all four layers instead. The two composition exceptions (recovery, device-pairing-new) get their own rules below, scoped to the exact accepted pair, and are carved out of this general rule via from.pathNot so their broader traffic still routes through those dedicated rules. The exception list is debt with its own ticket (promote recovery and device-pairing-new to widgets).',
      severity: 'error',
      from: {
        path: '^src/(pages|widgets|features|entities)/([^/]+)/',
        pathNot: '^src/features/(recovery|device-pairing-new)/',
      },
      to: {
        path: '^src/$1/',
        pathNot: '^src/$1/$2/',
      },
    },
    {
      name: 'fsd-no-cross-slice-recovery',
      comment:
        'Composition exception (accepted by S08-08): recovery may mount totp-challenge and totp-enrollment components, nothing else outside its own slice. Promoting recovery to a widget is a separate ticket.',
      severity: 'error',
      from: { path: '^src/features/recovery/' },
      to: {
        path: '^src/features/',
        pathNot: '^src/features/(recovery|totp-challenge|totp-enrollment)/',
      },
    },
    {
      name: 'fsd-no-cross-slice-device-pairing-new',
      comment:
        'Composition exception (accepted by S08-08): device-pairing-new may mount qr-scan components, nothing else outside its own slice. Promoting device-pairing-new to a widget is a separate ticket.',
      severity: 'error',
      from: { path: '^src/features/device-pairing-new/' },
      to: {
        path: '^src/features/',
        pathNot: '^src/features/(device-pairing-new|qr-scan)/',
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
