const firstPlugin = {
  name: 'cjs-named-engine-plugins-first',
  version: '1.0.0',
  apiVersion: '2026-07-01',
  pieceInvocationMiddleware: [
    {
      name: 'cjs-named-engine-plugins-first-middleware',
    },
  ],
}

const secondPlugin = {
  name: 'cjs-named-engine-plugins-second',
  version: '1.0.0',
  apiVersion: '2026-07-01',
  pieceInvocationMiddleware: [
    {
      name: 'cjs-named-engine-plugins-second-middleware',
    },
  ],
}

module.exports = {
  enginePlugins: [
    firstPlugin,
    secondPlugin,
  ],
}
