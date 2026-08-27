/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-xstate-in-types',
      comment:
        "types.ts é o contrato do package (a superfície que qualquer adapter/consumidor importa) e não pode depender de xstate — troca de biblioteca de statechart no futuro não deve obrigar a reescrever o contrato.",
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
