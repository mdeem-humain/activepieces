import { describe, expect, it } from 'vitest'
import { NetworkMode, WorkerProps, WorkerSettingsResponse } from '../../../src/lib/workers'

describe('WorkerSettingsResponse', () => {
    it('accepts engine plugin settings', () => {
        const parsed = WorkerSettingsResponse.parse(createWorkerSettingsResponse())

        expect(parsed.ENGINE_PLUGINS).toBe('[]')
        expect(parsed.ENGINE_PLUGIN_HOOK_TIMEOUT_MS).toBe(5000)
        expect(parsed.ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS).toBe(30000)
    })

    it('requires engine plugin config to be a string', () => {
        expect(() => WorkerSettingsResponse.parse({
            ...createWorkerSettingsResponse(),
            ENGINE_PLUGINS: [],
        })).toThrow()
    })

    it('accepts optional configured engine plugin worker metadata', () => {
        const parsed = WorkerProps.parse({
            enginePlugins: [
                {
                    packageName: '@acme/engine-plugin',
                    version: 'unknown',
                },
            ],
        })

        expect(parsed.enginePlugins).toEqual([
            {
                packageName: '@acme/engine-plugin',
                version: 'unknown',
            },
        ])
        expect(WorkerProps.parse({}).enginePlugins).toBeUndefined()
    })
})

function createWorkerSettingsResponse(): Record<string, unknown> {
    return {
        PUBLIC_URL: 'https://example.com',
        TRIGGER_TIMEOUT_SECONDS: 60,
        TRIGGER_HOOKS_TIMEOUT_SECONDS: 180,
        PAUSED_FLOW_TIMEOUT_DAYS: 30,
        EXECUTION_MODE: 'SANDBOX_PROCESS',
        FLOW_TIMEOUT_SECONDS: 600,
        LOG_LEVEL: 'info',
        LOG_PRETTY: 'false',
        ENVIRONMENT: 'test',
        APP_WEBHOOK_SECRETS: '{}',
        ENGINE_PLUGINS: '[]',
        ENGINE_PLUGIN_HOOK_TIMEOUT_MS: 5000,
        ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS: 30000,
        MAX_FLOW_RUN_LOG_SIZE_MB: 50,
        MAX_FILE_SIZE_MB: 25,
        SANDBOX_MEMORY_LIMIT: '1048576',
        SANDBOX_PROPAGATED_ENV_VARS: [],
        DEV_PIECES: [],
        FILE_STORAGE_LOCATION: 'DB',
        S3_USE_SIGNED_URLS: 'false',
        EVENT_DESTINATION_TIMEOUT_SECONDS: 10,
        EDITION: 'ce',
        NETWORK_MODE: NetworkMode.UNRESTRICTED,
        SSRF_ALLOW_LIST: [],
    }
}
