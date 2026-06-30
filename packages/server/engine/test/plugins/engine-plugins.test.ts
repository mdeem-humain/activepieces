import { beforeEach, describe, expect, it } from 'vitest'
import { enginePlugins } from '../../src/lib/plugins/engine-plugins'
import type { EnginePlugin } from '../../src/lib/plugins/engine-plugin'

describe('enginePlugins registry', () => {
    beforeEach(() => {
        enginePlugins.clear()
    })

    it('fails registration for duplicate plugin names', () => {
        enginePlugins.register(createPlugin({ name: 'duplicate-plugin' }))

        expect(() => enginePlugins.register(createPlugin({ name: 'duplicate-plugin' })))
            .toThrow('Engine plugin "duplicate-plugin" is already registered')
    })

    it('fails registration for duplicate middleware names within one plugin', () => {
        expect(() => enginePlugins.register(createPlugin({
            name: 'duplicate-middleware-plugin',
            middlewareNames: ['shared-middleware', 'shared-middleware'],
        }))).toThrow('Engine plugin "duplicate-middleware-plugin" defines duplicate piece invocation middleware "shared-middleware"')

        expect(enginePlugins.getRegisteredPlugins()).toEqual([])
    })

    it('allows duplicate middleware names across different plugins', () => {
        enginePlugins.register(createPlugin({
            name: 'first-plugin',
            middlewareNames: ['shared-middleware'],
        }))
        enginePlugins.register(createPlugin({
            name: 'second-plugin',
            middlewareNames: ['shared-middleware'],
        }))

        expect(enginePlugins.getPieceInvocationMiddleware().map((middleware) => middleware.name))
            .toEqual(['shared-middleware', 'shared-middleware'])
    })

    it('preserves registration order for metadata and middleware', () => {
        enginePlugins.register({
            plugin: createPlugin({
                name: 'first-plugin',
                version: '1.0.0',
                middlewareNames: ['first-middleware'],
            }),
            packageName: '@acme/first-plugin',
        })
        enginePlugins.register({
            plugin: createPlugin({
                name: 'second-plugin',
                version: '2.0.0',
                middlewareNames: ['second-middleware'],
            }),
            packageName: '@acme/second-plugin',
        })

        expect(enginePlugins.getRegisteredPlugins()).toEqual([
            {
                name: 'first-plugin',
                version: '1.0.0',
                apiVersion: '2026-07-01',
                packageName: '@acme/first-plugin',
            },
            {
                name: 'second-plugin',
                version: '2.0.0',
                apiVersion: '2026-07-01',
                packageName: '@acme/second-plugin',
            },
        ])
        expect(enginePlugins.getPieceInvocationMiddleware().map((middleware) => middleware.name))
            .toEqual(['first-middleware', 'second-middleware'])
    })

    it('clear resets registry state', () => {
        enginePlugins.register(createPlugin({
            name: 'reset-plugin',
            middlewareNames: ['reset-middleware'],
        }))

        enginePlugins.clear()

        expect(enginePlugins.getRegisteredPlugins()).toEqual([])
        expect(enginePlugins.getPieceInvocationMiddleware()).toEqual([])
        expect(() => enginePlugins.register(createPlugin({ name: 'reset-plugin' }))).not.toThrow()
    })
})

function createPlugin({
    name,
    version = '1.0.0',
    middlewareNames = [],
}: {
    name: string
    version?: string
    middlewareNames?: string[]
}): EnginePlugin {
    return {
        name,
        version,
        apiVersion: '2026-07-01',
        pieceInvocationMiddleware: middlewareNames.map((middlewareName) => ({
            name: middlewareName,
        })),
    }
}
