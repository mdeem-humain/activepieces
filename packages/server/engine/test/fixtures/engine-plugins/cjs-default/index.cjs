const plugin = {
  name: 'cjs-default-plugin',
  version: '1.0.0',
  apiVersion: '2026-07-01',
  pieceInvocationMiddleware: [
    {
      name: 'cjs-default-middleware',
    },
  ],
}

module.exports = {
  default: plugin,
}
