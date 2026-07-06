import { ExecutionMode } from '@activepieces/shared'
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
        getOrThrow: vi.fn().mockReturnValue('test-value'),
        getNumberOrThrow: vi.fn().mockReturnValue(60),
        getNumber: vi.fn().mockReturnValue(undefined),
        get: vi.fn().mockReturnValue(undefined),
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
} as any

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
}

describe('machineService — execution mode', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.resetModules()
    })

    it('should return system default execution mode for shared workers', async () => {
        vi.mocked(system.getOrThrow).mockReturnValue(ExecutionMode.SANDBOX_PROCESS as any)

        const { machineService: freshMachineService } = await import('../../../../../src/app/workers/machine/machine-service')
        const result = await freshMachineService(mockLog).onConnection(mockHealthcheck)

        expect(result.EXECUTION_MODE).toBe(ExecutionMode.SANDBOX_PROCESS)
    })

    it('should return system default execution mode for dedicated workers', async () => {
        vi.mocked(system.getOrThrow).mockReturnValue(ExecutionMode.SANDBOX_CODE_AND_PROCESS as any)

        const { machineService: freshMachineService } = await import('../../../../../src/app/workers/machine/machine-service')
        const result = await freshMachineService(mockLog).onConnection(mockHealthcheck, 'my-worker-group')

        expect(result.EXECUTION_MODE).toBe(ExecutionMode.SANDBOX_CODE_AND_PROCESS)
    })

    it('should include engine plugin settings', async () => {
        const enginePlugins = JSON.stringify([
            {
                packageName: '@acme/engine-plugin',
            },
        ])
        vi.mocked(system.getOrThrow).mockImplementation((prop) => {
            return prop === AppSystemProp.ENGINE_PLUGINS
                ? enginePlugins
                : 'test-value'
        })
        vi.mocked(system.getNumberOrThrow).mockImplementation((prop) => {
            if (prop === AppSystemProp.ENGINE_PLUGIN_HOOK_TIMEOUT_MS) {
                return 7000
            }
            if (prop === AppSystemProp.ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS) {
                return 35000
            }
            return 60
        })

        const { machineService: freshMachineService } = await import('../../../../../src/app/workers/machine/machine-service')
        const result = await freshMachineService(mockLog).onConnection(mockHealthcheck)

        expect(result.ENGINE_PLUGINS).toBe(enginePlugins)
        expect(result.ENGINE_PLUGIN_HOOK_TIMEOUT_MS).toBe(7000)
        expect(result.ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS).toBe(35000)
    })
})
