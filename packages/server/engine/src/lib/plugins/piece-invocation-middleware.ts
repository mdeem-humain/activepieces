import type {
    PieceInvocationAfterResult,
    PieceInvocationBeforeResult,
    PieceInvocationContext,
    PieceInvocationMiddleware,
    PieceInvocationPhase,
    PieceNameMatcher,
} from './engine-plugin'
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
            canReplaceOutput,
        })
        if (canReplaceOutput && afterResult !== undefined && hasOutputReplacement(afterResult)) {
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
        .filter((middleware) => matchesPieceName({
            match: middleware.match,
            pieceName: context.pieceName,
        }))
}

function matchesPieceName({
    match,
    pieceName,
}: {
    match?: PieceInvocationMatcher
    pieceName: string
}): boolean {
    if (match === undefined) {
        return true
    }
    if (typeof match === 'string') {
        return match === pieceName
    }
    if (match instanceof RegExp) {
        match.lastIndex = 0
        return match.test(pieceName)
    }
    return match({ pieceName })
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

function hasOutputReplacement(
    result: PieceInvocationAfterResult<unknown>,
): boolean {
    return Object.prototype.hasOwnProperty.call(result, 'output')
}

export { runWithPieceInvocationMiddleware }

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

export type {
    PieceInvocationContext,
    PieceInvocationMiddleware,
    PieceInvocationPhase,
    PieceNameMatcher,
}
