import { describe, expect, it } from 'vitest'

import { startEngine } from '../../src/main'

describe('engine startup', () => {
    it('loads plugins before initializing the worker socket', async () => {
        const context = createTestRuntime({
            sandboxId: TEST_SANDBOX_ID,
        })

        await startEngine({
            runtime: context.runtime,
        })

        expect(context.getEvents()).toEqual([
            'register-uncaught-exception',
            'register-unhandled-rejection',
            'install-ssrf-guard',
            `set-title:sandbox-${TEST_SANDBOX_ID}`,
            'load-plugins',
            `init-worker-socket:${TEST_SANDBOX_ID}`,
            'init-progress-reporter',
        ])
    })

    it('does not load plugins or initialize sockets when SANDBOX_ID is unset', async () => {
        const context = createTestRuntime()

        await startEngine({
            runtime: context.runtime,
        })

        expect(context.getEvents()).toEqual([
            'register-uncaught-exception',
            'register-unhandled-rejection',
            'install-ssrf-guard',
            'set-title:sandbox-undefined',
        ])
        expect(context.getProcessTitle()).toBe('sandbox-undefined')
    })

    it('logs loader startup failures to stderr and exits with the startup code', async () => {
        const startupError = new Error('plugin loader failed')
        const context = createTestRuntime({
            sandboxId: TEST_SANDBOX_ID,
            loadPlugins: async () => {
                throw startupError
            },
        })

        await startEngine({
            runtime: context.runtime,
        })

        expect(context.getEvents()).toEqual([
            'register-uncaught-exception',
            'register-unhandled-rejection',
            'install-ssrf-guard',
            `set-title:sandbox-${TEST_SANDBOX_ID}`,
            'load-plugins',
            'log-startup-failure',
            `exit:${STARTUP_FAILURE_EXIT_CODE}`,
        ])
        expect(context.getStartupFailures()).toEqual([startupError])
        expect(context.getSentErrors()).toEqual([])
    })

    it('sends uncaught exceptions through the worker socket after startup', async () => {
        const context = createTestRuntime({
            sandboxId: TEST_SANDBOX_ID,
        })
        const uncaughtError = new Error('uncaught failure')

        await startEngine({
            runtime: context.runtime,
        })
        context.emitUncaughtException(uncaughtError)

        expect(context.getSentErrors()).toEqual([uncaughtError])
        expect(context.getExitCode()).toBe(UNCAUGHT_EXCEPTION_EXIT_CODE)
    })

    it('sends unhandled rejections through the worker socket after startup', async () => {
        const context = createTestRuntime({
            sandboxId: TEST_SANDBOX_ID,
        })
        const rejectionReason = new Error('rejection failure')

        await startEngine({
            runtime: context.runtime,
        })
        context.emitUnhandledRejection(rejectionReason)

        expect(context.getSentErrors()).toEqual([rejectionReason])
        expect(context.getExitCode()).toBe(UNHANDLED_REJECTION_EXIT_CODE)
    })
})

function createTestRuntime({
    sandboxId,
    loadPlugins = async () => undefined,
    installSsrfGuard = () => undefined,
    initWorkerSocket = () => undefined,
    initProgressReporter = () => undefined,
}: TestRuntimeInput = {}): TestRuntimeContext {
    let events: string[] = []
    let processTitle: string | undefined
    let exitCode: number | undefined
    let sentErrors: unknown[] = []
    let startupFailures: unknown[] = []
    let uncaughtExceptionHandlers: UncaughtExceptionHandler[] = []
    let unhandledRejectionHandlers: UnhandledRejectionHandler[] = []

    const runtime: EngineStartupRuntime = {
        getSandboxId: () => sandboxId,
        setProcessTitle: (title) => {
            processTitle = title
            events = [...events, `set-title:${title}`]
        },
        onUncaughtException: (handler) => {
            uncaughtExceptionHandlers = [...uncaughtExceptionHandlers, handler]
            events = [...events, 'register-uncaught-exception']
        },
        onUnhandledRejection: (handler) => {
            unhandledRejectionHandlers = [...unhandledRejectionHandlers, handler]
            events = [...events, 'register-unhandled-rejection']
        },
        exit: (code) => {
            exitCode = code
            events = [...events, `exit:${code}`]
        },
        logStartupFailure: (error) => {
            startupFailures = [...startupFailures, error]
            events = [...events, 'log-startup-failure']
        },
        ssrfGuard: {
            install: () => {
                events = [...events, 'install-ssrf-guard']
                installSsrfGuard()
            },
        },
        enginePluginLoader: {
            load: async () => {
                events = [...events, 'load-plugins']
                await loadPlugins()
            },
        },
        workerSocket: {
            init: (sandboxId) => {
                events = [...events, `init-worker-socket:${sandboxId}`]
                initWorkerSocket(sandboxId)
            },
            sendError: (error) => {
                sentErrors = [...sentErrors, error]
            },
        },
        flowRunProgressReporter: {
            init: () => {
                events = [...events, 'init-progress-reporter']
                initProgressReporter()
            },
        },
    }

    return {
        runtime,
        getEvents: () => events,
        getProcessTitle: () => processTitle,
        getExitCode: () => exitCode,
        getSentErrors: () => sentErrors,
        getStartupFailures: () => startupFailures,
        emitUncaughtException: (error) => {
            uncaughtExceptionHandlers.forEach((handler) => handler(error))
        },
        emitUnhandledRejection: (reason) => {
            unhandledRejectionHandlers.forEach((handler) => handler(reason))
        },
    }
}

const TEST_SANDBOX_ID = 'sandbox-id'
const STARTUP_FAILURE_EXIT_CODE = 7
const UNCAUGHT_EXCEPTION_EXIT_CODE = 3
const UNHANDLED_REJECTION_EXIT_CODE = 4

type EngineStartupRuntime = NonNullable<NonNullable<Parameters<typeof startEngine>[0]>['runtime']>
type UncaughtExceptionHandler = Parameters<EngineStartupRuntime['onUncaughtException']>[0]
type UnhandledRejectionHandler = Parameters<EngineStartupRuntime['onUnhandledRejection']>[0]

type TestRuntimeInput = {
    sandboxId?: string
    loadPlugins?: () => Promise<void>
    installSsrfGuard?: () => void
    initWorkerSocket?: (sandboxId: string) => void
    initProgressReporter?: () => void
}

type TestRuntimeContext = {
    runtime: EngineStartupRuntime
    getEvents: () => string[]
    getProcessTitle: () => string | undefined
    getExitCode: () => number | undefined
    getSentErrors: () => unknown[]
    getStartupFailures: () => unknown[]
    emitUncaughtException: (error: Error) => void
    emitUnhandledRejection: (reason: unknown) => void
}
