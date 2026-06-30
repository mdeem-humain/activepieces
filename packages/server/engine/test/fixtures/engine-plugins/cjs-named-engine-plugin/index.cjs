const enginePlugin = {
  name: 'cjs-named-engine-plugin',
  version: '1.0.0',
  apiVersion: '2026-07-01',
  pieceInvocationMiddleware: [
    {
      name: 'cjs-named-engine-plugin-middleware',
    },
  ],
}

module.exports = {
  enginePlugin,
}
