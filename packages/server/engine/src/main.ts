import { isNil, tryCatch } from '@activepieces/core-utils'
import { flowRunProgressReporter } from './lib/helper/flow-run-progress-reporter'
import { ssrfGuard } from './lib/network/ssrf-guard'
import { enginePluginLoader } from './lib/plugins'
import { workerSocket } from './lib/worker-socket'

registerFatalErrorHandlers()
ssrfGuard.install()

const SANDBOX_ID = process.env.SANDBOX_ID
process.title = `sandbox-${SANDBOX_ID}`

if (!isNil(SANDBOX_ID)) {
    void startSandboxEngine({ sandboxId: SANDBOX_ID })
}

async function startSandboxEngine({
    sandboxId,
}: {
    sandboxId: string
}): Promise<void> {
    const { error } = await tryCatch(() => enginePluginLoader.load())
    if (error !== null) {
        logStartupFailure(error)
        process.exit(STARTUP_FAILURE_EXIT_CODE)
    }
    workerSocket.init(sandboxId)
    flowRunProgressReporter.init()
}

function registerFatalErrorHandlers(): void {
    process.on('uncaughtException', (error) => {
        workerSocket.sendError(error)
        process.exit(UNCAUGHT_EXCEPTION_EXIT_CODE)
    })

    process.on('unhandledRejection', (reason) => {
        workerSocket.sendError(reason)
        process.exit(UNHANDLED_REJECTION_EXIT_CODE)
    })
}

function logStartupFailure(error: unknown): void {
    // eslint-disable-next-line no-console
    console.error('[engine] Failed to start engine', error)
}

const UNCAUGHT_EXCEPTION_EXIT_CODE = 3
const UNHANDLED_REJECTION_EXIT_CODE = 4
const STARTUP_FAILURE_EXIT_CODE = 7
