/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-xstate-in-types',
      comment:
        "ADR-0008: types.ts é o contrato do package (a superfície que S05-02 e qualquer outro consumidor importam) e não pode depender de xstate — troca de biblioteca de statechart no futuro não deve obrigar a reescrever o contrato.",
      severity: 'error',
      from: { path: '^src/types\\.ts$' },
      // `to.path` casa contra o caminho resolvido, não contra o especificador —
      // `^xstate$` nunca dispara porque resolve para dentro de node_modules.
      to: { dependencyTypes: ['npm'], path: 'node_modules/xstate/' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
  },
}
