module.exports = {
  default: {
    name: 'on-load-order-plugin',
    version: '1.0.0',
    apiVersion: '2026-07-01',
    onLoad({ logger }) {
      logger.info('on-load-order-loaded')
    },
  },
}
