import type {
    HookFailurePolicy,
    PieceInvocationAfterResult,
    PieceInvocationBeforeResult,
    PieceInvocationContext,
    PieceInvocationMatcher,
    PieceInvocationMiddleware,
    PieceInvocationPhase,
} from '@activepieces/core-execution'
import { EnginePluginHookTimeoutConfigSchema } from '@activepieces/core-execution'
import { tryCatch, tryCatchSync } from '@activepieces/core-utils'
import { enginePlugins } from './engine-plugins'

async function runWithPieceInvocationMiddleware<T>({
    context,
    input,
    invoke,
}: {
    context: PieceInvocationContext
    input?: unknown
    invoke: (input?: unknown) => Promise<T>
}): Promise<T> {
    const matchingMiddleware = getMatchingMiddleware({ context })
    const canReplaceInput = canReplaceValue({ phase: context.phase })
    const canReplaceOutput = canReplaceValue({ phase: context.phase })
    let nextInput = input

    for (const middleware of matchingMiddleware) {
        if (middleware.middleware.before === undefined) {
            continue
        }
        const beforeResult = await runMiddlewareHook({
            registration: middleware,
            hookName: 'before',
            run: () => middleware.middleware.before?.({
                ...context,
                input: nextInput,
                canReplaceInput,
                canReplaceOutput,
            }),
        })
        if (canReplaceInput && beforeResult !== undefined && hasInputReplacement(beforeResult)) {
            nextInput = beforeResult.input
        }
    }

    const startTime = performance.now()
    let invocationResult: PieceInvocationResult<T>

    try {
        invocationResult = {
            success: true,
            output: await invoke(nextInput),
        }
    }
    catch (error) {
        invocationResult = {
            success: false,
            error,
        }
    }

    const durationMs = performance.now() - startTime
    const middlewareForAfter = [...matchingMiddleware].reverse()
    const invocationFailed = !invocationResult.success
    const invocationError = invocationResult.success ? undefined : invocationResult.error
    let successOutput = invocationResult.success
        ? {
            output: invocationResult.output,
        }
        : undefined

    for (const middleware of middlewareForAfter) {
        if (middleware.middleware.after === undefined) {
            continue
        }
        const afterResult = await runMiddlewareHook({
            registration: middleware,
            hookName: 'after',
            run: () => middleware.middleware.after?.({
                ...context,
                output: successOutput?.output,
                error: invocationError,
                durationMs,
                canReplaceInput,
                canReplaceOutput,
            }),
        })
        if (!invocationFailed && canReplaceOutput && afterResult !== undefined && hasOutputReplacement<T>(afterResult)) {
            successOutput = {
                output: afterResult.output,
            }
        }
    }

    if (invocationFailed) {
        throw invocationError
    }
    if (successOutput === undefined) {
        throw new Error('Piece invocation middleware completed without output')
    }

    return successOutput.output
}

function getMatchingMiddleware({
    context,
}: {
    context: PieceInvocationContext
}): RegisteredPieceInvocationMiddleware[] {
    return enginePlugins
        .getRegisteredPieceInvocationMiddleware()
        .filter((registration) => matchesPieceInvocationContext({
            context,
            match: registration.middleware.match,
        }))
}

function matchesPieceInvocationContext({
    context,
    match,
}: {
    match?: PieceInvocationMatcher
    context: PieceInvocationContext
}): boolean {
    if (match === undefined) {
        return true
    }
    if (typeof match === 'string') {
        return match === context.pieceName
    }
    if (match instanceof RegExp) {
        match.lastIndex = 0
        return match.test(context.pieceName)
    }
    if (typeof match === 'function') {
        return match(context)
    }
    if ('pieceName' in match) {
        return matchesConfiguredPieceName({
            configuredPieceName: match.pieceName,
            pieceName: context.pieceName,
        })
    }
    return matchesPieceNamePattern({
        pieceNamePattern: match.pieceNamePattern,
        pieceName: context.pieceName,
    })
}

function matchesConfiguredPieceName({
    configuredPieceName,
    pieceName,
}: {
    configuredPieceName: string | string[]
    pieceName: string
}): boolean {
    if (Array.isArray(configuredPieceName)) {
        return configuredPieceName.includes(pieceName)
    }
    return configuredPieceName === pieceName
}

function matchesPieceNamePattern({
    pieceNamePattern,
    pieceName,
}: {
    pieceNamePattern: string
    pieceName: string
}): boolean {
    const patternResult = tryCatchSync<RegExp, unknown>(() => new RegExp(pieceNamePattern))
    if (patternResult.error !== null) {
        throw new Error(`Invalid pieceNamePattern matcher "${pieceNamePattern}"`)
    }
    return patternResult.data.test(pieceName)
}

function canReplaceValue({
    phase,
}: {
    phase: PieceInvocationPhase
}): boolean {
    return REPLACEABLE_PHASES.includes(phase)
}

function hasInputReplacement<TInput>(result: PieceInvocationBeforeResult<TInput>): boolean {
    return Object.prototype.hasOwnProperty.call(result, 'input')
}

function hasOutputReplacement<TOutput>(
    result: PieceInvocationAfterResult<unknown>,
): result is OutputReplacement<TOutput> {
    return Object.prototype.hasOwnProperty.call(result, 'output')
}

async function runMiddlewareHook<TResult>({
    registration,
    hookName,
    run,
}: RunMiddlewareHookParams<TResult>): Promise<TResult | undefined> {
    const timeoutConfig = getHookTimeoutConfig()
    const timeoutMs = Math.min(
        registration.middleware.timeoutMs ?? timeoutConfig.timeoutMs,
        timeoutConfig.maxTimeoutMs,
    )
    const failurePolicy = getHookFailurePolicy({ registration })
    logHookMatched({
        registration,
        hookName,
        timeoutMs,
        failurePolicy,
    })
    const startTime = performance.now()
    const hookResult = await tryCatch<TResult | undefined, unknown>(() => withTimeout({
        promise: run(),
        timeoutMs,
        registration,
        hookName,
    }))
    if (hookResult.error === null) {
        logHookCompleted({
            registration,
            hookName,
            durationMs: performance.now() - startTime,
            failurePolicy,
        })
        return hookResult.data
    }

    const durationMs = performance.now() - startTime
    if (hookResult.error instanceof HookTimeoutError) {
        logHookTimedOut({
            registration,
            hookName,
            timeoutMs,
            durationMs,
            failurePolicy,
        })
    }
    else {
        logHookFailed({
            registration,
            hookName,
            error: hookResult.error,
            durationMs,
            failurePolicy,
        })
    }

    if (failurePolicy === 'log-and-continue') {
        return undefined
    }
    throw hookResult.error
}

function getHookTimeoutConfig(): HookTimeoutConfig {
    return EnginePluginHookTimeoutConfigSchema.parse({
        timeoutMs: getPositiveIntegerEnvironmentValue({ name: 'AP_ENGINE_PLUGIN_HOOK_TIMEOUT_MS' }),
        maxTimeoutMs: getPositiveIntegerEnvironmentValue({ name: 'AP_ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS' }),
    })
}

function getPositiveIntegerEnvironmentValue({
    name,
}: {
    name: string
}): number | undefined {
    const value = process.env[name]
    if (value === undefined || value.length === 0) {
        return undefined
    }
    return Number(value)
}

function getHookFailurePolicy({
    registration,
}: {
    registration: RegisteredPieceInvocationMiddleware
}): HookFailurePolicy {
    return registration.middleware.failurePolicy
        ?? registration.pluginHookFailurePolicy
        ?? DEFAULT_HOOK_FAILURE_POLICY
}

function logHookMatched({
    registration,
    hookName,
    timeoutMs,
    failurePolicy,
}: {
    registration: RegisteredPieceInvocationMiddleware
    hookName: HookName
    timeoutMs: number
    failurePolicy: HookFailurePolicy
}): void {
    console.info(createHookLogFields({
        registration,
        hookName,
        status: 'matched',
        failurePolicy,
        timeoutMs,
    }), 'Piece invocation middleware hook matched')
}

function logHookCompleted({
    registration,
    hookName,
    durationMs,
    failurePolicy,
}: {
    registration: RegisteredPieceInvocationMiddleware
    hookName: HookName
    durationMs: number
    failurePolicy: HookFailurePolicy
}): void {
    console.info(createHookLogFields({
        registration,
        hookName,
        status: 'completed',
        failurePolicy,
        durationMs,
    }), 'Piece invocation middleware hook completed')
}

function logHookFailed({
    registration,
    hookName,
    error,
    durationMs,
    failurePolicy,
}: {
    registration: RegisteredPieceInvocationMiddleware
    hookName: HookName
    error: unknown
    durationMs: number
    failurePolicy: HookFailurePolicy
}): void {
    const logFields = createHookLogFields({
        registration,
        hookName,
        status: 'failed',
        failurePolicy,
        durationMs,
        errorName: getErrorName({ error }),
    })

    if (failurePolicy === 'log-and-continue') {
        console.warn(logFields, 'Piece invocation middleware hook failed')
        return
    }
    console.error(logFields, 'Piece invocation middleware hook failed')
}

function logHookTimedOut({
    registration,
    hookName,
    timeoutMs,
    durationMs,
    failurePolicy,
}: {
    registration: RegisteredPieceInvocationMiddleware
    hookName: HookName
    timeoutMs: number
    durationMs: number
    failurePolicy: HookFailurePolicy
}): void {
    const logFields = createHookLogFields({
        registration,
        hookName,
        status: 'timed-out',
        failurePolicy,
        timeoutMs,
        durationMs,
        errorName: HookTimeoutError.name,
    })

    if (failurePolicy === 'log-and-continue') {
        console.warn(logFields, 'Piece invocation middleware hook timed out')
        return
    }
    console.error(logFields, 'Piece invocation middleware hook timed out')
}

function createHookLogFields({
    registration,
    hookName,
    status,
    failurePolicy,
    timeoutMs,
    durationMs,
    errorName,
}: CreateHookLogFieldsParams): Record<string, unknown> {
    return {
        ...(registration.packageName === undefined ? {} : { packageName: registration.packageName }),
        pluginName: registration.pluginName,
        middlewareName: registration.middleware.name,
        hookName,
        status,
        failurePolicy,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(errorName === undefined ? {} : { errorName }),
    }
}

function getErrorName({
    error,
}: {
    error: unknown
}): string {
    return error instanceof Error ? error.name : typeof error
}

function withTimeout<TResult>({
    promise,
    timeoutMs,
    registration,
    hookName,
}: WithTimeoutParams<TResult>): Promise<TResult | undefined> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new HookTimeoutError({
                registration,
                hookName,
                timeoutMs,
            }))
        }, timeoutMs)

        Promise.resolve(promise)
            .then(resolve)
            .catch(reject)
            .finally(() => clearTimeout(timeout))
    })
}

class HookTimeoutError extends Error {
    constructor({
        registration,
        hookName,
        timeoutMs,
    }: HookTimeoutErrorParams) {
        super(`Piece invocation middleware "${registration.middleware.name}" ${hookName} hook timed out after ${timeoutMs}ms`)
        this.name = 'HookTimeoutError'
    }
}

const REPLACEABLE_PHASES: PieceInvocationPhase[] = [
    'action.run',
    'action.test',
    'trigger.run',
    'trigger.test',
]

const DEFAULT_HOOK_FAILURE_POLICY: HookFailurePolicy = 'fail-invocation'

type PieceInvocationResult<T> =
    | {
        success: true
        output: T
    }
    | {
        success: false
        error: unknown
    }

type PieceNameMatcher = PieceInvocationMatcher

type OutputReplacement<TOutput> = PieceInvocationAfterResult<TOutput> & {
    output: TOutput
}

type RegisteredPieceInvocationMiddleware = ReturnType<typeof enginePlugins.getRegisteredPieceInvocationMiddleware>[number]

type HookName = 'before' | 'after'

type HookLogStatus = 'matched' | 'completed' | 'failed' | 'timed-out'

type RunMiddlewareHookParams<TResult> = {
    registration: RegisteredPieceInvocationMiddleware
    hookName: HookName
    run: () => Promise<TResult | undefined> | TResult | undefined
}

type HookTimeoutConfig = {
    timeoutMs: number
    maxTimeoutMs: number
}

type CreateHookLogFieldsParams = {
    registration: RegisteredPieceInvocationMiddleware
    hookName: HookName
    status: HookLogStatus
    failurePolicy: HookFailurePolicy
    timeoutMs?: number
    durationMs?: number
    errorName?: string
}

type HookTimeoutErrorParams = {
    registration: RegisteredPieceInvocationMiddleware
    hookName: HookName
    timeoutMs: number
}

type WithTimeoutParams<TResult> = {
    promise: Promise<TResult | undefined> | TResult | undefined
    timeoutMs: number
    registration: RegisteredPieceInvocationMiddleware
    hookName: HookName
}

export { runWithPieceInvocationMiddleware }

export type {
    PieceInvocationContext,
    PieceInvocationMatcher,
    PieceInvocationMiddleware,
    PieceInvocationPhase,
    PieceNameMatcher,
}
