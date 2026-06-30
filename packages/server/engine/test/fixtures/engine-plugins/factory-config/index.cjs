function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function enginePlugin({ config, logger, environment }) {
  if (!isRecord(config)) {
    throw new Error('Expected object config')
  }

  logger.info({
    environment: environment.environment,
  }, 'factory-config-loaded')

  return {
    name: typeof config.pluginName === 'string' ? config.pluginName : 'factory-config-plugin',
    version: '1.0.0',
    apiVersion: '2026-07-01',
    pieceInvocationMiddleware: [
      {
        name: 'factory-config-middleware',
      },
    ],
  }
}

module.exports = {
  enginePlugin,
}
