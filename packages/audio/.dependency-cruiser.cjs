/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-runtime-deps',
      comment:
        'Núcleo de áudio (ring buffer, gate, decode CTC, loop de ASR) é lógica pura: nenhum ficheiro de produção pode importar um package npm.',
      severity: 'error',
      from: { path: '^src/', pathNot: '\\.test\\.ts$' },
      to: { dependencyTypes: ['npm'] },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
  },
}
