import { ExecutionMode, NetworkMode } from '@activepieces/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppSystemProp } from '../../../../../src/app/helper/system/system-props'

vi.mock('../../../../../src/app/workers/machine/machine-cache', () => ({
    workerMachineCache: vi.fn(() => ({
        findOne: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(undefined),
    })),
}))

vi.mock('../../../../../src/app/ee/platform/platform-plan/worker-group.service', () => ({
    workerGroupService: vi.fn(() => ({
        getWorkerGroupId: vi.fn().mockResolvedValue(undefined),
    })),
}))

vi.mock('../../../../../src/app/helper/system/system', () => ({
    system: {
        getOrThrow: vi.fn(),
        getNumberOrThrow: vi.fn(),
        getNumber: vi.fn(),
        get: vi.fn(),
    },
}))

vi.mock('../../../../../src/app/helper/domain-helper', () => ({
    domainHelper: {
        getPublicUrl: vi.fn().mockResolvedValue('https://example.com'),
    },
}))

import { system } from '../../../../../src/app/helper/system/system'

const mockLog = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'info',
}

const mockHealthcheck = {
    workerId: 'test-worker-1',
    cpuUsagePercentage: 10,
    ramUsagePercentage: 20,
    totalAvailableRamInBytes: 1024,
    diskInfo: {
        total: 1000,
        free: 500,
        used: 500,
        percentage: 50,
    },
    totalCpuCores: 2,
    ip: '127.0.0.1',
    sandboxes: [],
}

describe('machineService — execution mode', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()
        vi.mocked(system.getOrThrow).mockImplementation(getSystemValueOrThrow)
        vi.mocked(system.getNumberOrThrow).mockImplementation(getSystemNumberOrThrow)
        vi.mocked(system.getNumber).mockImplementation(getSystemNumberOrThrow)
        vi.mocked(system.get).mockReturnValue(undefined)
    })

    it('should return system default execution mode for shared workers', async () => {
        vi.mocked(system.getOrThrow).mockImplementation((prop) => {
            return prop === AppSystemProp.EXECUTION_MODE
                ? ExecutionMode.SANDBOX_PROCESS
                : getSystemValueOrThrow(prop)
        })

        const { machineService: freshMachineService } = await import('../../../../../src/app/workers/machine/machine-service')
        const result = await freshMachineService(mockLog).onConnection(mockHealthcheck)

        expect(result.EXECUTION_MODE).toBe(ExecutionMode.SANDBOX_PROCESS)
    })

    it('should return system default execution mode for dedicated workers', async () => {
        vi.mocked(system.getOrThrow).mockImplementation((prop) => {
            return prop === AppSystemProp.EXECUTION_MODE
                ? ExecutionMode.SANDBOX_CODE_AND_PROCESS
                : getSystemValueOrThrow(prop)
        })

        const { machineService: freshMachineService } = await import('../../../../../src/app/workers/machine/machine-service')
        const result = await freshMachineService(mockLog).onConnection(mockHealthcheck, 'my-worker-group')

        expect(result.EXECUTION_MODE).toBe(ExecutionMode.SANDBOX_CODE_AND_PROCESS)
    })

    it('should include engine plugins in worker settings', async () => {
        const enginePlugins = JSON.stringify([
            {
                packageName: '@acme/engine-plugin',
            },
        ])
        vi.mocked(system.getOrThrow).mockImplementation((prop) => {
            return prop === AppSystemProp.ENGINE_PLUGINS
                ? enginePlugins
                : getSystemValueOrThrow(prop)
        })

        const { machineService: freshMachineService } = await import('../../../../../src/app/workers/machine/machine-service')
        const result = await freshMachineService(mockLog).onConnection(mockHealthcheck)

        expect(result.ENGINE_PLUGINS).toBe(enginePlugins)
    })

    it('should include engine plugin timeout settings', async () => {
        vi.mocked(system.getNumberOrThrow).mockImplementation((prop) => {
            if (prop === AppSystemProp.ENGINE_PLUGIN_HOOK_TIMEOUT_MS) {
                return 7000
            }
            if (prop === AppSystemProp.ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS) {
                return 35000
            }
            return getSystemNumberOrThrow(prop)
        })

        const { machineService: freshMachineService } = await import('../../../../../src/app/workers/machine/machine-service')
        const result = await freshMachineService(mockLog).onConnection(mockHealthcheck)

        expect(result.ENGINE_PLUGIN_HOOK_TIMEOUT_MS).toBe(7000)
        expect(result.ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS).toBe(35000)
    })

    it('should return default empty engine plugin config when env var is not set', async () => {
        const { machineService: freshMachineService } = await import('../../../../../src/app/workers/machine/machine-service')
        const result = await freshMachineService(mockLog).onConnection(mockHealthcheck)

        expect(result.ENGINE_PLUGINS).toBe('[]')
    })
})

function getSystemValueOrThrow(prop: string): string {
    switch (prop) {
        case AppSystemProp.EXECUTION_MODE:
            return ExecutionMode.SANDBOX_PROCESS
        case AppSystemProp.LOG_LEVEL:
            return 'info'
        case AppSystemProp.LOG_PRETTY:
            return 'false'
        case AppSystemProp.ENVIRONMENT:
            return 'testing'
        case AppSystemProp.APP_WEBHOOK_SECRETS:
            return '{}'
        case AppSystemProp.ENGINE_PLUGINS:
            return '[]'
        case AppSystemProp.SANDBOX_MEMORY_LIMIT:
            return '1048576'
        case AppSystemProp.FILE_STORAGE_LOCATION:
            return 'DB'
        case AppSystemProp.S3_USE_SIGNED_URLS:
            return 'false'
        case AppSystemProp.EDITION:
            return 'ce'
        case AppSystemProp.NETWORK_MODE:
            return NetworkMode.UNRESTRICTED
        default:
            return 'test-value'
    }
}

function getSystemNumberOrThrow(prop: string): number {
    switch (prop) {
        case AppSystemProp.ENGINE_PLUGIN_HOOK_TIMEOUT_MS:
            return 5000
        case AppSystemProp.ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS:
            return 30000
        case AppSystemProp.EVENT_DESTINATION_TIMEOUT_SECONDS:
            return 10
        default:
            return 60
    }
}
