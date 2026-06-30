import {
    EnginePluginHookTimeoutConfigSchema,
    parseEnginePluginPackageConfigList,
} from '../../../src/lib/engine/plugins'

describe('parseEnginePluginPackageConfigList', () => {
    it('parses an empty config array', () => {
        const result = parseConfig({ value: '[]' })

        expect(result).toEqual([])
    })

    it('applies defaults for enabled and failurePolicy', () => {
        const result = parseConfig({
            value: JSON.stringify([
                {
                    packageName: '@acme/engine-plugin',
                },
            ]),
        })

        expect(result).toEqual([
            {
                packageName: '@acme/engine-plugin',
                enabled: true,
                failurePolicy: 'fail-startup',
            },
        ])
    })

    it('accepts scoped and unscoped npm package names', () => {
        const result = parseConfig({
            value: JSON.stringify([
                {
                    packageName: 'engine-plugin-redactor',
                },
                {
                    packageName: '@acme/engine-plugin-redactor',
                },
            ]),
        })

        expect(result.map((packageConfig) => packageConfig.packageName)).toEqual([
            'engine-plugin-redactor',
            '@acme/engine-plugin-redactor',
        ])
    })

    it.each([
        { label: 'unscoped subpath', packageName: 'engine-plugin/subpath' },
        { label: 'scoped subpath', packageName: '@acme/engine-plugin/subpath' },
        { label: 'windows path', packageName: 'engine-plugin\\subpath' },
        { label: 'relative parent path', packageName: '../engine-plugin' },
        { label: 'embedded parent segment', packageName: '@acme/../engine-plugin' },
        { label: 'null byte', packageName: 'engine-plugin\0name' },
        { label: 'http url', packageName: 'https://example.com/engine-plugin' },
        { label: 'file url', packageName: 'file:///tmp/engine-plugin' },
        { label: 'unsupported scheme', packageName: 'npm:@acme/engine-plugin' },
    ])('rejects $label package references', ({ packageName }) => {
        expect(() => parseConfig({
            value: JSON.stringify([
                {
                    packageName,
                },
            ]),
        })).toThrow('Invalid engine plugin package reference')
    })

    it('accepts absolute file paths only in development', () => {
        const value = JSON.stringify([
            {
                packageName: '/tmp/activepieces-engine-plugin',
            },
        ])

        expect(parseConfig({ value, environment: 'dev' })).toEqual([
            {
                packageName: '/tmp/activepieces-engine-plugin',
                enabled: true,
                failurePolicy: 'fail-startup',
            },
        ])
        expect(parseConfig({ value, environment: 'development' })).toEqual([
            {
                packageName: '/tmp/activepieces-engine-plugin',
                enabled: true,
                failurePolicy: 'fail-startup',
            },
        ])
        expect(() => parseConfig({ value, environment: 'prod' })).toThrow('absolute file paths')
    })

    it('rejects malformed JSON', () => {
        expect(() => parseConfig({ value: '{not-json' })).toThrow('Invalid engine plugin package config JSON')
    })
})

describe('EnginePluginHookTimeoutConfigSchema', () => {
    it('uses timeout defaults', () => {
        expect(EnginePluginHookTimeoutConfigSchema.parse({})).toEqual({
            timeoutMs: 5000,
            maxTimeoutMs: 30000,
        })
    })

    it('caps the default timeout at the configured max timeout', () => {
        expect(EnginePluginHookTimeoutConfigSchema.parse({
            maxTimeoutMs: 1000,
        })).toEqual({
            timeoutMs: 1000,
            maxTimeoutMs: 1000,
        })
    })

    it('caps configured timeout at the configured max timeout', () => {
        expect(EnginePluginHookTimeoutConfigSchema.parse({
            timeoutMs: 45000,
            maxTimeoutMs: 30000,
        })).toEqual({
            timeoutMs: 30000,
            maxTimeoutMs: 30000,
        })
    })

    it('rejects non-positive timeout values', () => {
        expect(() => EnginePluginHookTimeoutConfigSchema.parse({
            timeoutMs: 0,
        })).toThrow()
    })
})

function parseConfig({
    value,
    environment = 'prod',
}: {
    value: string
    environment?: string
}) {
    return parseEnginePluginPackageConfigList({
        value,
        environment,
    })
}
