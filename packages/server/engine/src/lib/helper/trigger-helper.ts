import { assertEqual, isNil } from '@activepieces/core-utils'
import { OnStartContext, PiecePropertyMap, StaticPropsValue, TestOrRunHookContext, TriggerHookContext, TriggerStrategy } from '@activepieces/pieces-framework'
import { AUTHENTICATION_PROPERTY_NAME, EngineGenericError, EventPayload, ExecuteTriggerResponse, FlowTrigger, InvalidCronExpressionError, PieceTrigger, PropertySettings, ScheduleOptions, TriggerHookType, TriggerSourceScheduleType } from '@activepieces/shared'
import { isValidCron } from 'cron-validator'
import { EngineConstants, ResolvedExecuteTriggerOperation } from '../handler/context/engine-constants'
import { FlowExecutorContext } from '../handler/context/flow-execution-context'
import { createFileUploader } from '../piece-context/file-uploader'
import { createFlowsContext } from '../piece-context/flows'
import { createContextStore } from '../piece-context/store'
import { runWithPieceInvocationMiddleware } from '../plugins/piece-invocation-middleware'
import { utils } from '../utils'
import { propsProcessor } from '../variables/props-processor'
import { createPropsResolver } from '../variables/props-resolver'
import { pieceLoader } from './piece-loader'
import type { PieceInvocationContext, PieceInvocationPhase } from '../plugins/engine-plugin'

type Listener = {
    events: string[]
    identifierValue: string
    identifierKey: string
}

export const triggerHelper = {
    async executeOnStart(trigger: FlowTrigger, constants: EngineConstants, payload: unknown) {
        const { pieceName, pieceVersion, triggerName, input, propertySettings } = (trigger as PieceTrigger).settings

        if (isNil(triggerName)) {
            throw new EngineGenericError('TriggerNameNotSetError', 'Trigger name is not set')
        }

        const { pieceTrigger, processedInput, piece } = await prepareTriggerExecution({
            pieceName,
            pieceVersion,
            triggerName,
            input,
            projectId: constants.projectId,
            apiUrl: constants.internalApiUrl,
            engineToken: constants.engineToken,
            devPieces: constants.devPieces,
            propertySettings,
            stepNames: constants.stepNames,
        })
        const isOldVersionOrNotSupported = isNil(pieceTrigger.onStart)
        if (isOldVersionOrNotSupported) {
            return
        }
        const context = {
            store: createContextStore({
                apiUrl: constants.internalApiUrl,
                prefix: '',
                flowId: constants.flowId,
                engineToken: constants.engineToken,
            }),
            auth: processedInput[AUTHENTICATION_PROPERTY_NAME],
            propsValue: processedInput,
            payload,
            run: {
                id: constants.flowRunId,
            },
            step: {
                name: triggerName,
            },
            project: {
                id: constants.projectId,
                externalId: constants.externalProjectId,
            },
            connections: utils.createConnectionManager({
                apiUrl: constants.internalApiUrl,
                projectId: constants.projectId,
                engineToken: constants.engineToken,
                target: 'triggers',
                contextVersion: piece.getContextInfo?.().version,
            }),
        }
        await runWithPieceInvocationMiddleware({
            context: createPieceInvocationContext({
                pieceName,
                pieceVersion,
                phase: 'trigger.onStart',
                projectId: constants.projectId,
                platformId: constants.platformId,
                flowId: constants.flowId,
                flowVersionId: constants.flowVersionId,
                flowRunId: constants.flowRunId,
                stepName: trigger.name,
                actionOrTriggerName: triggerName,
            }),
            input: context,
            invoke: async (input) => {
                if (!isOnStartContext(input)) {
                    throw new EngineGenericError('InvalidPieceInvocationInputError', 'Piece trigger middleware returned an invalid onStart context')
                }
                return pieceTrigger.onStart(input)
            },
        })
    },

    async executeTrigger({ params, constants }: ExecuteTriggerParams): Promise<ExecuteTriggerResponse<TriggerHookType>> {
        const { pieceName, pieceVersion, triggerName, input, propertySettings } = (params.flowVersion.trigger as PieceTrigger).settings

        if (isNil(triggerName)) {
            throw new EngineGenericError('TriggerNameNotSetError', 'Trigger name is not set')
        }

        const { piece, pieceTrigger, processedInput } = await prepareTriggerExecution({
            pieceName,
            pieceVersion,
            triggerName,
            input,
            projectId: params.projectId,
            apiUrl: constants.internalApiUrl,
            engineToken: params.engineToken,
            devPieces: constants.devPieces,
            propertySettings,
            stepNames: constants.stepNames,
        })

        const appListeners: Listener[] = []
        const prefix = params.test ? 'test' : ''
        let scheduleOptions: ScheduleOptions | undefined = undefined
        const context = {
            store: createContextStore({
                apiUrl: constants.internalApiUrl,
                prefix,
                flowId: params.flowVersion.flowId,
                engineToken: params.engineToken,
            }),
            step: {
                name: triggerName,
            },
            app: {
                createListeners({ events, identifierKey, identifierValue }: Listener): void {
                    appListeners.push({ events, identifierValue, identifierKey })
                },
            },
            setSchedule(request: ScheduleOptions) {
                if (!isValidCron(request.cronExpression)) {
                    throw new InvalidCronExpressionError(request.cronExpression)
                }
                scheduleOptions = {
                    type: TriggerSourceScheduleType.CRON_EXPRESSION,
                    cronExpression: request.cronExpression,
                    timezone: request.timezone ?? 'UTC',
                }
            },
            flows: createFlowsContext({
                engineToken: params.engineToken,
                internalApiUrl: constants.internalApiUrl,
                flowId: params.flowVersion.flowId,
                flowVersionId: params.flowVersion.id,
            }),
            webhookUrl: params.webhookUrl,
            auth: processedInput[AUTHENTICATION_PROPERTY_NAME],
            propsValue: processedInput,
            payload: params.triggerPayload ?? {},
            project: {
                id: params.projectId,
                externalId: constants.externalProjectId,
            },
            server: {
                token: params.engineToken,
                apiUrl: constants.internalApiUrl,
                publicUrl: params.publicApiUrl,
            },
            connections: utils.createConnectionManager({
                apiUrl: constants.internalApiUrl,
                projectId: constants.projectId,
                engineToken: constants.engineToken,
                target: 'triggers',
                contextVersion: piece.getContextInfo?.().version,
            }),
        }
        switch (params.hookType) {
            case TriggerHookType.ON_DISABLE: {
                await runWithPieceInvocationMiddleware({
                    context: createPieceInvocationContextFromExecuteTrigger({
                        params,
                        constants,
                        pieceName,
                        pieceVersion,
                        triggerName,
                        phase: 'trigger.onDisable',
                    }),
                    input: context,
                    invoke: async (input) => {
                        if (!isTriggerHookContext(input)) {
                            throw new EngineGenericError('InvalidPieceInvocationInputError', 'Piece trigger middleware returned an invalid onDisable context')
                        }
                        return pieceTrigger.onDisable(input)
                    },
                })
                return {}
            }
            case TriggerHookType.ON_ENABLE: {
                await runWithPieceInvocationMiddleware({
                    context: createPieceInvocationContextFromExecuteTrigger({
                        params,
                        constants,
                        pieceName,
                        pieceVersion,
                        triggerName,
                        phase: 'trigger.onEnable',
                    }),
                    input: context,
                    invoke: async (input) => {
                        if (!isTriggerHookContext(input)) {
                            throw new EngineGenericError('InvalidPieceInvocationInputError', 'Piece trigger middleware returned an invalid onEnable context')
                        }
                        return pieceTrigger.onEnable(input)
                    },
                })
                return {
                    listeners: appListeners,
                    scheduleOptions: pieceTrigger.type === TriggerStrategy.POLLING ? scheduleOptions : undefined,
                }
            }
            case TriggerHookType.RENEW: {
                assertEqual(pieceTrigger.type, TriggerStrategy.WEBHOOK, 'triggerType', 'WEBHOOK')
                await runWithPieceInvocationMiddleware({
                    context: createPieceInvocationContextFromExecuteTrigger({
                        params,
                        constants,
                        pieceName,
                        pieceVersion,
                        triggerName,
                        phase: 'trigger.onRenew',
                    }),
                    input: context,
                    invoke: async (input) => {
                        if (!isTriggerHookContext(input)) {
                            throw new EngineGenericError('InvalidPieceInvocationInputError', 'Piece trigger middleware returned an invalid onRenew context')
                        }
                        return pieceTrigger.onRenew(input)
                    },
                })
                return {}
            }
            case TriggerHookType.HANDSHAKE: {
                const { data: handshakeResponse, error: handshakeResponseError } = await utils.tryCatchAndThrowOnEngineError(() => runWithPieceInvocationMiddleware({
                    context: createPieceInvocationContextFromExecuteTrigger({
                        params,
                        constants,
                        pieceName,
                        pieceVersion,
                        triggerName,
                        phase: 'trigger.onHandshake',
                    }),
                    input: context,
                    invoke: async (input) => {
                        if (!isTriggerHookContext(input)) {
                            throw new EngineGenericError('InvalidPieceInvocationInputError', 'Piece trigger middleware returned an invalid onHandshake context')
                        }
                        return pieceTrigger.onHandshake(input)
                    },
                }))

                if (handshakeResponseError) {
                    throw handshakeResponseError
                }
                return {
                    response: handshakeResponse,
                }
            }
            case TriggerHookType.TEST: {
                const testContext = {
                    ...context,
                    files: createFileUploader({
                        apiUrl: constants.internalApiUrl,
                        engineToken: params.engineToken!,
                    }),
                }
                const { data: testResponse, error: testResponseError } = await utils.tryCatchAndThrowOnEngineError(() => runWithPieceInvocationMiddleware({
                    context: createPieceInvocationContextFromExecuteTrigger({
                        params,
                        constants,
                        pieceName,
                        pieceVersion,
                        triggerName,
                        phase: 'trigger.test',
                    }),
                    input: testContext,
                    invoke: async (input) => {
                        if (!isTestOrRunHookContext(input)) {
                            throw new EngineGenericError('InvalidPieceInvocationInputError', 'Piece trigger middleware returned an invalid test context')
                        }
                        return pieceTrigger.test(input)
                    },
                }))

                if (testResponseError) {
                    throw testResponseError
                }
                return {
                    output: testResponse,
                }
            }
            case TriggerHookType.RUN: {
                if (pieceTrigger.type === TriggerStrategy.APP_WEBHOOK) {

                    const { data: verified, error: verifiedError } = await utils.tryCatchAndThrowOnEngineError(async () => {
                        if (!params.appWebhookUrl) {
                            throw new EngineGenericError('AppWebhookUrlNotAvailableError', `App webhook url is not available for piece name ${pieceName}`)
                        }
                        if (!params.webhookSecret) {
                            throw new EngineGenericError('WebhookSecretNotAvailableError', `Webhook secret is not available for piece name ${pieceName}`)
                        }

                        return piece.events?.verify({
                            appWebhookUrl: params.appWebhookUrl,
                            payload: params.triggerPayload as EventPayload,
                            webhookSecret: params.webhookSecret,
                        })
                    })

                    if (verifiedError) {
                        throw verifiedError
                    }
                    if (isNil(verified)) {
                        throw new Error('Webhook is not verified')
                    }
                }

                const { data: triggerRunResult, error: triggerRunError } = await utils.tryCatchAndThrowOnEngineError(async () => {
                    const runContext = {
                        ...context,
                        files: createFileUploader({
                            apiUrl: constants.internalApiUrl,
                            engineToken: params.engineToken!,
                        }),
                    }
                    const items = await runWithPieceInvocationMiddleware({
                        context: createPieceInvocationContextFromExecuteTrigger({
                            params,
                            constants,
                            pieceName,
                            pieceVersion,
                            triggerName,
                            phase: 'trigger.run',
                        }),
                        input: runContext,
                        invoke: async (input) => {
                            if (!isTestOrRunHookContext(input)) {
                                throw new EngineGenericError('InvalidPieceInvocationInputError', 'Piece trigger middleware returned an invalid run context')
                            }
                            return pieceTrigger.run(input)
                        },
                    })
                    return {
                        output: items,
                    }
                })

                if (triggerRunError) {
                    throw triggerRunError
                }
                return triggerRunResult
            }
        }
    },
}

type ExecuteTriggerParams = {
    params: ResolvedExecuteTriggerOperation<TriggerHookType>
    constants: EngineConstants
}

async function prepareTriggerExecution({ pieceName, pieceVersion, triggerName, input, propertySettings, projectId, apiUrl, engineToken, devPieces, stepNames }: PrepareTriggerExecutionParams) {
    const { piece, pieceTrigger } = await pieceLoader.getPieceAndTriggerOrThrow({
        pieceName,
        pieceVersion,
        triggerName,
        devPieces,
    })

    const { resolvedInput } = await createPropsResolver({
        apiUrl,
        projectId,
        engineToken,
        contextVersion: piece.getContextInfo?.().version,
        stepNames,
    }).resolve<StaticPropsValue<PiecePropertyMap>>({
        unresolvedInput: input,
        executionState: FlowExecutorContext.empty(),
    })

    const { processedInput, errors } = await propsProcessor.applyProcessorsAndValidators(resolvedInput, pieceTrigger.props, piece.auth, pieceTrigger.requireAuth, propertySettings)

    if (Object.keys(errors).length > 0) {
        throw new Error(JSON.stringify(errors, null, 2))
    }

    return { piece, pieceTrigger, processedInput }
}

function createPieceInvocationContextFromExecuteTrigger({
    params,
    constants,
    pieceName,
    pieceVersion,
    triggerName,
    phase,
}: CreatePieceInvocationContextFromExecuteTriggerParams): PieceInvocationContext {
    return createPieceInvocationContext({
        pieceName,
        pieceVersion,
        phase,
        projectId: params.projectId,
        platformId: params.platformId,
        flowId: params.flowVersion.flowId,
        flowVersionId: params.flowVersion.id,
        flowRunId: constants.flowRunId,
        stepName: params.flowVersion.trigger.name,
        actionOrTriggerName: triggerName,
    })
}

function createPieceInvocationContext(params: PieceInvocationContext): PieceInvocationContext {
    return params
}

function isOnStartContext(input: unknown): input is OnStartContext<unknown, PiecePropertyMap> {
    return typeof input === 'object'
        && input !== null
        && 'propsValue' in input
        && 'payload' in input
}

function isTriggerHookContext(input: unknown): input is TriggerHookContext<unknown, PiecePropertyMap, TriggerStrategy> {
    return typeof input === 'object'
        && input !== null
        && 'propsValue' in input
        && 'store' in input
}

function isTestOrRunHookContext(input: unknown): input is TestOrRunHookContext<unknown, PiecePropertyMap, TriggerStrategy> {
    return typeof input === 'object'
        && input !== null
        && 'propsValue' in input
        && 'files' in input
}

type PrepareTriggerExecutionParams = {
    pieceName: string
    pieceVersion: string
    triggerName: string
    input: unknown
    propertySettings: Record<string, PropertySettings>
    projectId: string
    apiUrl: string
    engineToken: string
    devPieces: string[]
    stepNames: string[]
}

type CreatePieceInvocationContextFromExecuteTriggerParams = {
    params: ResolvedExecuteTriggerOperation<TriggerHookType>
    constants: EngineConstants
    pieceName: string
    pieceVersion: string
    triggerName: string
    phase: PieceInvocationPhase
}
