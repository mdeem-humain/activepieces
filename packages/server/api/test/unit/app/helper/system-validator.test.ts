import { ApEnvironment } from '@activepieces/shared'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateEnvPropsOnStartup } from '../../../../src/app/helper/system-validator'

const originalEnv = { ...process.env }
const mockLog = {
    warn: vi.fn(),
}

describe('validateEnvPropsOnStartup — engine plugin config', () => {
    beforeEach(() => {
        process.env = {
            ...originalEnv,
            AP_ENVIRONMENT: ApEnvironment.TESTING,
            AP_ENCRYPTION_KEY: '12345678901234567890123456789012',
            AP_JWT_SECRET: 'test-jwt-secret',
        }
        delete process.env.AP_CODE_SANDBOX_TYPE
        delete process.env.AP_ENGINE_PLUGINS
        delete process.env.AP_ENGINE_PLUGIN_HOOK_TIMEOUT_MS
        delete process.env.AP_ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS
        mockLog.warn.mockClear()
    })

    afterAll(() => {
        process.env = originalEnv
    })

    it('passes valid plugin JSON', async () => {
        process.env.AP_ENGINE_PLUGINS = JSON.stringify([
            {
                packageName: '@acme/engine-plugin',
            },
        ])

        await expect(validateEnvPropsOnStartup(mockLog)).resolves.toBeUndefined()
    })

    it('fails startup for malformed plugin JSON', async () => {
        process.env.AP_ENGINE_PLUGINS = '{not-json'

        await expect(validateEnvPropsOnStartup(mockLog)).rejects.toThrow('AP_ENGINE_PLUGINS is invalid')
    })

    it('fails startup for an invalid plugin package name', async () => {
        process.env.AP_ENGINE_PLUGINS = JSON.stringify([
            {
                packageName: 'https://example.com/plugin',
            },
        ])

        await expect(validateEnvPropsOnStartup(mockLog)).rejects.toThrow('AP_ENGINE_PLUGINS is invalid')
    })

    it('fails startup for non-positive plugin hook timeout values', async () => {
        process.env.AP_ENGINE_PLUGIN_HOOK_TIMEOUT_MS = '0'

        await expect(validateEnvPropsOnStartup(mockLog)).rejects.toThrow('AP_ENGINE_PLUGIN_HOOK_TIMEOUT_MS')
    })

    it('does not print plugin config values in validation errors', async () => {
        process.env.AP_ENGINE_PLUGINS = JSON.stringify([
            {
                packageName: '../private-engine-plugin',
                config: {
                    token: 'secret-plugin-token',
                },
            },
        ])

        const errorMessage = await getValidationErrorMessage()

        expect(errorMessage).toContain('AP_ENGINE_PLUGINS is invalid')
        expect(errorMessage).not.toContain('../private-engine-plugin')
        expect(errorMessage).not.toContain('secret-plugin-token')
        expect(errorMessage).not.toContain('packageName')
    })
})

async function getValidationErrorMessage(): Promise<string> {
    try {
        await validateEnvPropsOnStartup(mockLog)
    }
    catch (error: unknown) {
        return error instanceof Error ? error.message : String(error)
    }
    throw new Error('Expected validation to fail')
}
