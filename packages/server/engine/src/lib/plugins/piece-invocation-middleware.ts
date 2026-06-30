import type {
    PieceInvocationAfterResult,
    PieceInvocationBeforeResult,
    PieceInvocationContext,
    PieceInvocationMatcher,
    PieceInvocationMiddleware,
    PieceInvocationPhase,
} from '@activepieces/core-execution'
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
        const beforeResult = await middleware.before?.({
            ...context,
            input: nextInput,
            canReplaceInput,
            canReplaceOutput,
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
        const afterResult = await middleware.after?.({
            ...context,
            output: successOutput?.output,
            error: invocationError,
            durationMs,
            canReplaceInput,
            canReplaceOutput,
        })
        if (canReplaceOutput && afterResult !== undefined && hasOutputReplacement<T>(afterResult)) {
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
}): PieceInvocationMiddleware[] {
    return enginePlugins
        .getPieceInvocationMiddleware()
        .filter((middleware) => matchesPieceInvocationContext({
            context,
            match: middleware.match,
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
    return new RegExp(pieceNamePattern).test(pieceName)
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

const REPLACEABLE_PHASES: PieceInvocationPhase[] = [
    'action.run',
    'action.test',
    'trigger.run',
    'trigger.test',
]

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

export { runWithPieceInvocationMiddleware }

export type {
    PieceInvocationContext,
    PieceInvocationMatcher,
    PieceInvocationMiddleware,
    PieceInvocationPhase,
    PieceNameMatcher,
}
