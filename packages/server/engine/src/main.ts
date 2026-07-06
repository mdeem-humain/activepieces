import { isNil, tryCatch } from '@activepieces/core-utils'
import { flowRunProgressReporter } from './lib/helper/flow-run-progress-reporter'
import { ssrfGuard } from './lib/network/ssrf-guard'
import { enginePluginLoader } from './lib/plugins'
import { workerSocket } from './lib/worker-socket'

ssrfGuard.install()

const SANDBOX_ID = process.env.SANDBOX_ID
process.title = `sandbox-${SANDBOX_ID}`

if (!isNil(SANDBOX_ID)) {
    void startSandboxEngine(SANDBOX_ID)
}

async function startSandboxEngine(sandboxId: string): Promise<void> {
    const { error } = await tryCatch(() => enginePluginLoader.load())
    if (error !== null) {
        logStartupFailure(error)
        process.exit(7)
    }
    workerSocket.init(sandboxId)
    flowRunProgressReporter.init()
}

function logStartupFailure(error: unknown): void {
    // eslint-disable-next-line no-console
    console.error('[engine] Failed to start engine', error)
}

process.on('uncaughtException', (error) => {
    workerSocket.sendError(error)
    process.exit(3)
})

process.on('unhandledRejection', (reason) => {
    workerSocket.sendError(reason)
    process.exit(4)
})
