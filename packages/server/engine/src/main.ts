import { isNil, tryCatch } from '@activepieces/core-utils'
import { flowRunProgressReporter } from './lib/helper/flow-run-progress-reporter'
import { ssrfGuard } from './lib/network/ssrf-guard'
import { enginePluginLoader } from './lib/plugins'
import { workerSocket } from './lib/worker-socket'

async function startEngine({
    runtime = createEngineStartupRuntime(),
}: StartEngineParams = {}): Promise<void> {
    let workerSocketInitialized = false

    registerFatalErrorHandlers({
        runtime,
    })

    const startupResult = await tryCatch<undefined, unknown>(async (): Promise<undefined> => {
        runtime.ssrfGuard.install()

        const sandboxId = runtime.getSandboxId()
        runtime.setProcessTitle(`sandbox-${sandboxId}`)

        if (isNil(sandboxId)) {
            return undefined
        }

        await runtime.enginePluginLoader.load()
        runtime.workerSocket.init(sandboxId)
        workerSocketInitialized = true
        runtime.flowRunProgressReporter.init()
        return undefined
    })

    if (startupResult.error !== null) {
        handleStartupFailure({
            error: startupResult.error,
            runtime,
            workerSocketInitialized,
        })
    }
}

if (isMainModule()) {
    void startEngine()
}

function registerFatalErrorHandlers({
    runtime,
}: {
    runtime: EngineStartupRuntime
}): void {
    runtime.onUncaughtException((error) => {
        runtime.workerSocket.sendError(error)
        runtime.exit(UNCAUGHT_EXCEPTION_EXIT_CODE)
    })

    runtime.onUnhandledRejection((reason) => {
        runtime.workerSocket.sendError(reason)
        runtime.exit(UNHANDLED_REJECTION_EXIT_CODE)
    })
}

function handleStartupFailure({
    error,
    runtime,
    workerSocketInitialized,
}: {
    error: unknown
    runtime: EngineStartupRuntime
    workerSocketInitialized: boolean
}): void {
    if (workerSocketInitialized) {
        runtime.workerSocket.sendError(error)
    }
    else {
        runtime.logStartupFailure(error)
    }
    runtime.exit(STARTUP_FAILURE_EXIT_CODE)
}

function createEngineStartupRuntime(): EngineStartupRuntime {
    return {
        getSandboxId: (): string | undefined => process.env.SANDBOX_ID,
        setProcessTitle: (title): void => {
            process.title = title
        },
        onUncaughtException: (handler): void => {
            process.on('uncaughtException', handler)
        },
        onUnhandledRejection: (handler): void => {
            process.on('unhandledRejection', handler)
        },
        exit: (code): void => {
            process.exit(code)
        },
        logStartupFailure,
        ssrfGuard,
        enginePluginLoader,
        workerSocket,
        flowRunProgressReporter,
    }
}

function logStartupFailure(error: unknown): void {
    // eslint-disable-next-line no-console
    console.error('[engine] Failed to start engine', error)
}

function isMainModule(): boolean {
    return typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module
}

const UNCAUGHT_EXCEPTION_EXIT_CODE = 3
const UNHANDLED_REJECTION_EXIT_CODE = 4
const STARTUP_FAILURE_EXIT_CODE = 7

type StartEngineParams = {
    runtime?: EngineStartupRuntime
}

type EngineStartupRuntime = {
    getSandboxId: () => string | undefined
    setProcessTitle: (title: string) => void
    onUncaughtException: (handler: (error: Error) => void) => void
    onUnhandledRejection: (handler: (reason: unknown) => void) => void
    exit: (code: number) => void
    logStartupFailure: (error: unknown) => void
    ssrfGuard: EngineStartupSsrfGuard
    enginePluginLoader: EngineStartupPluginLoader
    workerSocket: EngineStartupWorkerSocket
    flowRunProgressReporter: EngineStartupFlowRunProgressReporter
}

type EngineStartupSsrfGuard = {
    install: () => void
}

type EngineStartupPluginLoader = {
    load: () => Promise<void>
}

type EngineStartupWorkerSocket = {
    init: (sandboxId: string) => void
    sendError: (error: unknown) => void
}

type EngineStartupFlowRunProgressReporter = {
    init: () => void
}

export { startEngine }
