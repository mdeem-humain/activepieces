import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { enginePluginLoader } from '../../src/lib/plugins'
import { enginePlugins } from '../../src/lib/plugins/engine-plugins'

describe('enginePluginLoader', () => {
    let originalApEnginePlugins: string | undefined
    let originalApEnvironment: string | undefined
    let originalNodeEnvironment: string | undefined
    let originalApActivepiecesVersion: string | undefined
    let originalApEdition: string | undefined
    let loggedConsoleInput: unknown[][]

    beforeEach(() => {
        originalApEnginePlugins = process.env.AP_ENGINE_PLUGINS
        originalApEnvironment = process.env.AP_ENVIRONMENT
        originalNodeEnvironment = process.env.NODE_ENV
        originalApActivepiecesVersion = process.env.AP_ACTIVEPIECES_VERSION
        originalApEdition = process.env.AP_EDITION
        loggedConsoleInput = []

        enginePlugins.clear()
        process.env.AP_ENVIRONMENT = 'development'
        delete process.env.AP_ENGINE_PLUGINS

        vi.spyOn(console, 'debug').mockImplementation(() => undefined)
        vi.spyOn(console, 'info').mockImplementation((...input: unknown[]) => {
            loggedConsoleInput = [
                ...loggedConsoleInput,
                input,
            ]
        })
        vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
        enginePlugins.clear()
        vi.restoreAllMocks()
        restoreEnvValue({
            name: 'AP_ENGINE_PLUGINS',
            value: originalApEnginePlugins,
        })
        restoreEnvValue({
            name: 'AP_ENVIRONMENT',
            value: originalApEnvironment,
        })
        restoreEnvValue({
            name: 'NODE_ENV',
            value: originalNodeEnvironment,
        })
        restoreEnvValue({
            name: 'AP_ACTIVEPIECES_VERSION',
            value: originalApActivepiecesVersion,
        })
        restoreEnvValue({
            name: 'AP_EDITION',
            value: originalApEdition,
        })
    })

    it('loads no plugins when the environment variable is empty', async () => {
        await enginePluginLoader.load()

        expect(enginePlugins.getRegisteredPlugins()).toEqual([])
        expect(enginePlugins.getPieceInvocationMiddleware()).toEqual([])
    })

    it('fails on invalid JSON', async () => {
        process.env.AP_ENGINE_PLUGINS = '{not-json'

        await expect(enginePluginLoader.load()).rejects.toThrow('Invalid engine plugin package config JSON')
        expect(enginePlugins.getRegisteredPlugins()).toEqual([])
    })

    it('fails on invalid package names before resolution', async () => {
        await loadWithPackageConfigs({
            packageConfigs: [
                {
                    packageName: '../engine-plugin',
                },
            ],
            expectFailure: true,
            expectedErrorMessage: 'Invalid engine plugin package reference',
        })

        expect(enginePlugins.getRegisteredPlugins()).toEqual([])
    })

    it('skips config rows where enabled is false', async () => {
        await loadWithPackageConfigs({
            packageConfigs: [
                {
                    packageName: fixturePackagePath('import-throw'),
                    enabled: false,
                },
            ],
        })

        expect(enginePlugins.getRegisteredPlugins()).toEqual([])
    })

    it('loads CommonJS and ESM fixture plugins', async () => {
        await loadWithPackageConfigs({
            packageConfigs: [
                {
                    packageName: fixturePackagePath('cjs-default'),
                },
                {
                    packageName: fixturePackagePath('cjs-named-engine-plugin'),
                },
                {
                    packageName: fixturePackagePath('cjs-named-engine-plugins'),
                },
                {
                    packageName: fixturePackagePath('esm-default'),
                },
            ],
        })

        expect(enginePlugins.getRegisteredPlugins().map((plugin) => plugin.name)).toEqual([
            'cjs-default-plugin',
            'cjs-named-engine-plugin',
            'cjs-named-engine-plugins-first',
            'cjs-named-engine-plugins-second',
            'esm-default-plugin',
        ])
        expect(enginePlugins.getPieceInvocationMiddleware().map((middleware) => middleware.name)).toEqual([
            'cjs-default-middleware',
            'cjs-named-engine-plugin-middleware',
            'cjs-named-engine-plugins-first-middleware',
            'cjs-named-engine-plugins-second-middleware',
            'esm-default-middleware',
        ])
    })

    it('selects the exact exportName when provided', async () => {
        await loadWithPackageConfigs({
            packageConfigs: [
                {
                    packageName: fixturePackagePath('fallback-order'),
                    exportName: 'enginePlugin',
                },
            ],
        })

        expect(enginePlugins.getRegisteredPlugins().map((plugin) => plugin.name)).toEqual([
            'fallback-engine-plugin',
        ])
    })

    it('uses default before named fallback exports', async () => {
        await loadWithPackageConfigs({
            packageConfigs: [
                {
                    packageName: fixturePackagePath('fallback-order'),
                },
            ],
        })

        expect(enginePlugins.getRegisteredPlugins().map((plugin) => plugin.name)).toEqual([
            'fallback-default-plugin',
        ])
    })

    it('passes config to factories without logging config values', async () => {
        await loadWithPackageConfigs({
            packageConfigs: [
                {
                    packageName: fixturePackagePath('factory-config'),
                    config: {
                        pluginName: 'configured-factory-plugin',
                        secret: 'top-secret-value',
                    },
                },
            ],
        })

        expect(enginePlugins.getRegisteredPlugins()).toEqual([
            {
                name: 'configured-factory-plugin',
                version: '1.0.0',
                apiVersion: '2026-07-01',
                packageName: fixturePackagePath('factory-config'),
            },
        ])
        expect(JSON.stringify(loggedConsoleInput)).not.toContain('top-secret-value')
    })

    it('fails on invalid descriptors', async () => {
        await loadWithPackageConfigs({
            packageConfigs: [
                {
                    packageName: fixturePackagePath('invalid-descriptor'),
                },
            ],
            expectFailure: true,
            expectedErrorMessage: 'must define a non-empty string name',
        })

        expect(enginePlugins.getRegisteredPlugins()).toEqual([])
    })

    it('fails on unsupported API versions', async () => {
        await loadWithPackageConfigs({
            packageConfigs: [
                {
                    packageName: fixturePackagePath('unsupported-api-version'),
                },
            ],
            expectFailure: true,
            expectedErrorMessage: 'unsupported apiVersion',
        })

        expect(enginePlugins.getRegisteredPlugins()).toEqual([])
    })

    it('validates optional package manifests', async () => {
        await loadWithPackageConfigs({
            packageConfigs: [
                {
                    packageName: fixturePackagePath('manifest-valid'),
                },
            ],
        })

        expect(enginePlugins.getRegisteredPlugins().map((plugin) => plugin.name)).toEqual([
            'manifest-valid-plugin',
        ])

        enginePlugins.clear()

        await loadWithPackageConfigs({
            packageConfigs: [
                {
                    packageName: fixturePackagePath('manifest-wrong-kind'),
                },
            ],
            expectFailure: true,
            expectedErrorMessage: 'activepieces.kind',
        })
    })

    it('continues after a failed package when failurePolicy is skip-plugin', async () => {
        await loadWithPackageConfigs({
            packageConfigs: [
                {
                    packageName: fixturePackagePath('import-throw'),
                    failurePolicy: 'skip-plugin',
                },
                {
                    packageName: fixturePackagePath('cjs-default'),
                },
            ],
        })

        expect(enginePlugins.getRegisteredPlugins().map((plugin) => plugin.name)).toEqual([
            'cjs-default-plugin',
        ])
    })

    it('fails startup by default when a package cannot be loaded', async () => {
        await loadWithPackageConfigs({
            packageConfigs: [
                {
                    packageName: fixturePackagePath('import-throw'),
                },
            ],
            expectFailure: true,
            expectedErrorMessage: 'fixture import failed',
        })

        expect(enginePlugins.getRegisteredPlugins()).toEqual([])
    })

    it('runs onLoad after successful registration', async () => {
        const events: string[] = []
        const originalRegister = enginePlugins.register
        enginePlugins.register = (input) => {
            events.push('register')
            originalRegister(input)
        }
        vi.spyOn(console, 'info').mockImplementation((...input: unknown[]) => {
            loggedConsoleInput = [
                ...loggedConsoleInput,
                input,
            ]
            if (input.includes('on-load-order-loaded')) {
                events.push('onLoad')
            }
        })

        try {
            await loadWithPackageConfigs({
                packageConfigs: [
                    {
                        packageName: fixturePackagePath('on-load-order'),
                    },
                ],
            })
        }
        finally {
            enginePlugins.register = originalRegister
        }

        expect(events).toEqual([
            'register',
            'onLoad',
        ])
        expect(enginePlugins.getRegisteredPlugins().map((plugin) => plugin.name)).toEqual([
            'on-load-order-plugin',
        ])
    })
})

async function loadWithPackageConfigs({
    packageConfigs,
    expectFailure = false,
    expectedErrorMessage,
}: {
    packageConfigs: EnginePluginPackageConfigInput[]
    expectFailure?: boolean
    expectedErrorMessage?: string
}): Promise<void> {
    process.env.AP_ENGINE_PLUGINS = JSON.stringify(packageConfigs)
    if (expectFailure) {
        await expect(enginePluginLoader.load()).rejects.toThrow(expectedErrorMessage)
        return
    }
    await enginePluginLoader.load()
}

function fixturePackagePath(fixtureName: string): string {
    return path.resolve(__dirname, '../fixtures/engine-plugins', fixtureName)
}

function restoreEnvValue({
    name,
    value,
}: {
    name: string
    value?: string
}): void {
    if (value === undefined) {
        delete process.env[name]
        return
    }
    process.env[name] = value
}

type EnginePluginPackageConfigInput = {
    packageName: string
    exportName?: string
    enabled?: boolean
    failurePolicy?: 'fail-startup' | 'skip-plugin'
    config?: unknown
}
