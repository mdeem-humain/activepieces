type PieceNameMatcher =
    | string
    | RegExp
    | ((params: { pieceName: string }) => boolean)

type PieceInvocationPhase =
    | 'action.run'
    | 'action.test'
    | 'trigger.onStart'
    | 'trigger.onEnable'
    | 'trigger.onDisable'
    | 'trigger.onRenew'
    | 'trigger.onHandshake'
    | 'trigger.test'
    | 'trigger.run'
    | 'property.options'
    | 'property.props'
    | 'auth.validate'
    | 'metadata.extract'

type PieceInvocationContext = {
    pieceName: string
    pieceVersion: string
    phase: PieceInvocationPhase
    projectId?: string
    platformId?: string
    flowId?: string
    flowVersionId?: string
    flowRunId?: string
    stepName?: string
    actionOrTriggerName?: string
}

type PieceInvocationBeforeResult<TInput> = {
    input?: TInput
}

type PieceInvocationAfterResult<TOutput> = {
    output?: TOutput
}

type PieceInvocationMiddleware = {
    name: string
    match?: PieceNameMatcher
    before?: <TInput>(context: PieceInvocationContext & {
        input?: TInput
        canReplaceInput: boolean
    }) => Promise<PieceInvocationBeforeResult<TInput> | undefined>
    after?: (context: PieceInvocationContext & {
        canReplaceOutput: boolean
        durationMs: number
        output?: unknown
        error?: unknown
    }) => Promise<PieceInvocationAfterResult<unknown> | undefined>
}

type EnginePlugin = {
    name: string
    pieceInvocationMiddleware?: PieceInvocationMiddleware[]
}

export type {
    EnginePlugin,
    PieceInvocationAfterResult,
    PieceInvocationBeforeResult,
    PieceInvocationContext,
    PieceInvocationMiddleware,
    PieceInvocationPhase,
    PieceNameMatcher,
}
