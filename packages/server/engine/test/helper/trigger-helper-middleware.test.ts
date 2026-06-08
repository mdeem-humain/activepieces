import { TriggerStrategy } from '@activepieces/pieces-framework'
import { FlowTriggerType, FlowVersionState, PropertyExecutionType, TriggerHookType } from '@activepieces/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineConstants, ResolvedExecuteTriggerOperation } from '../../src/lib/handler/context/engine-constants'
import { triggerHelper } from '../../src/lib/helper/trigger-helper'
import { enginePlugins } from '../../src/lib/plugins/engine-plugins'
import { generateMockEngineConstants } from '../handler/test-helper'
import type { FlowVersion } from '@activepieces/shared'

const { mockGetPieceAndTriggerOrThrow } = vi.hoisted(() => ({
    mockGetPieceAndTriggerOrThrow: vi.fn(),
}))

vi.mock('../../src/lib/helper/piece-loader', () => ({
    pieceLoader: {
        getPieceAndTriggerOrThrow: mockGetPieceAndTriggerOrThrow,
    },
}))

vi.mock('../../src/lib/variables/props-resolver', () => ({
    createPropsResolver: () => ({
        resolve: vi.fn().mockResolvedValue({
            resolvedInput: {
                authType: 'none',
            },
        }),
    }),
}))

vi.mock('../../src/lib/variables/props-processor', () => ({
    propsProcessor: {
        applyProcessorsAndValidators: vi.fn().mockResolvedValue({
            processedInput: {
                authType: 'none',
            },
            errors: {},
        }),
    },
}))

describe('triggerHelper piece invocation middleware', () => {
    beforeEach(() => {
        enginePlugins.clear()
        mockGetPieceAndTriggerOrThrow.mockReset()
        mockGetPieceAndTriggerOrThrow.mockResolvedValue(createLoadedTrigger())
    })

    it('maps trigger hook methods to middleware phases', async () => {
        const phases: string[] = []
        enginePlugins.register({
            name: 'trigger-phase-plugin',
            pieceInvocationMiddleware: [{
                name: 'trigger-phase-middleware',
                before: async ({ phase }) => {
                    phases.push(phase)
                },
            }],
        })

        await triggerHelper.executeTrigger(createExecuteTriggerParams({ hookType: TriggerHookType.RUN }))
        await triggerHelper.executeTrigger(createExecuteTriggerParams({ hookType: TriggerHookType.TEST }))
        await triggerHelper.executeTrigger(createExecuteTriggerParams({ hookType: TriggerHookType.ON_ENABLE }))
        await triggerHelper.executeTrigger(createExecuteTriggerParams({ hookType: TriggerHookType.ON_DISABLE }))
        await triggerHelper.executeTrigger(createExecuteTriggerParams({ hookType: TriggerHookType.RENEW }))
        await triggerHelper.executeTrigger(createExecuteTriggerParams({ hookType: TriggerHookType.HANDSHAKE }))
        await triggerHelper.executeOnStart(createFlowVersion().trigger, createEngineConstants(), createPayload({ marker: 'start' }))

        expect(phases).toEqual([
            'trigger.run',
            'trigger.test',
            'trigger.onEnable',
            'trigger.onDisable',
            'trigger.onRenew',
            'trigger.onHandshake',
            'trigger.onStart',
        ])
    })

    it('matches trigger middleware by trigger piece name', async () => {
        const calls: string[] = []
        enginePlugins.register({
            name: 'trigger-match-plugin',
            pieceInvocationMiddleware: [
                {
                    name: 'matching-trigger-middleware',
                    match: '@activepieces/piece-webhook',
                    before: async ({ pieceName }) => {
                        calls.push(pieceName)
                    },
                },
                {
                    name: 'non-matching-trigger-middleware',
                    match: '@activepieces/piece-http',
                    before: async ({ pieceName }) => {
                        calls.push(pieceName)
                    },
                },
            ],
        })

        await triggerHelper.executeTrigger(createExecuteTriggerParams({ hookType: TriggerHookType.RUN }))

        expect(calls).toEqual(['@activepieces/piece-webhook'])
    })

    it('allows trigger run middleware to replace context input and returned items', async () => {
        enginePlugins.register({
            name: 'trigger-run-replacement-plugin',
            pieceInvocationMiddleware: [{
                name: 'trigger-run-replacement-middleware',
                before: async ({ input, canReplaceInput }) => {
                    expect(canReplaceInput).toBe(true)
                    if (!hasPayload(input)) {
                        return
                    }
                    return {
                        input: {
                            ...input,
                            payload: createPayload({ marker: 'before-run' }),
                        },
                    }
                },
                after: async ({ output, canReplaceOutput }) => {
                    expect(canReplaceOutput).toBe(true)
                    expect(output).toEqual([createPayload({ marker: 'before-run' })])
                    return {
                        output: [{ marker: 'after-run' }],
                    }
                },
            }],
        })

        const result = await triggerHelper.executeTrigger(createExecuteTriggerParams({ hookType: TriggerHookType.RUN }))

        expect(result).toEqual({
            output: [{ marker: 'after-run' }],
        })
    })

    it('allows trigger test middleware to replace context input and returned items', async () => {
        enginePlugins.register({
            name: 'trigger-test-replacement-plugin',
            pieceInvocationMiddleware: [{
                name: 'trigger-test-replacement-middleware',
                before: async ({ input, canReplaceInput }) => {
                    expect(canReplaceInput).toBe(true)
                    if (!hasPayload(input)) {
                        return
                    }
                    return {
                        input: {
                            ...input,
                            payload: createPayload({ marker: 'before-test' }),
                        },
                    }
                },
                after: async ({ output, canReplaceOutput }) => {
                    expect(canReplaceOutput).toBe(true)
                    expect(output).toEqual([createPayload({ marker: 'before-test' })])
                    return {
                        output: [{ marker: 'after-test' }],
                    }
                },
            }],
        })

        const result = await triggerHelper.executeTrigger(createExecuteTriggerParams({ hookType: TriggerHookType.TEST }))

        expect(result).toEqual({
            output: [{ marker: 'after-test' }],
        })
    })

    it('ignores replacement results for trigger lifecycle hooks', async () => {
        const loadedTrigger = createLoadedTrigger()
        mockGetPieceAndTriggerOrThrow.mockResolvedValue(loadedTrigger)
        enginePlugins.register({
            name: 'trigger-lifecycle-observe-plugin',
            pieceInvocationMiddleware: [{
                name: 'trigger-lifecycle-observe-middleware',
                before: async ({ canReplaceInput }) => {
                    expect(canReplaceInput).toBe(false)
                    return {
                        input: {
                            invalid: true,
                        },
                    }
                },
                after: async ({ canReplaceOutput }) => {
                    expect(canReplaceOutput).toBe(false)
                    return {
                        output: {
                            ignored: true,
                        },
                    }
                },
            }],
        })

        await triggerHelper.executeTrigger(createExecuteTriggerParams({ hookType: TriggerHookType.ON_ENABLE }))

        expect(loadedTrigger.pieceTrigger.onEnable).toHaveBeenCalledTimes(1)
    })

    it('passes trigger errors to after middleware and preserves thrown errors', async () => {
        const error = new Error('trigger failed')
        mockGetPieceAndTriggerOrThrow.mockResolvedValue(createLoadedTrigger({
            run: async () => {
                throw error
            },
        }))
        const observedErrors: unknown[] = []
        enginePlugins.register({
            name: 'trigger-error-plugin',
            pieceInvocationMiddleware: [{
                name: 'trigger-error-middleware',
                after: async ({ error: observedError }) => {
                    observedErrors.push(observedError)
                },
            }],
        })

        await expect(triggerHelper.executeTrigger(createExecuteTriggerParams({ hookType: TriggerHookType.RUN }))).rejects.toBe(error)
        expect(observedErrors).toEqual([error])
    })
})

function createLoadedTrigger(overrides?: LoadedTriggerOverrides) {
    const pieceTrigger = {
        type: TriggerStrategy.WEBHOOK,
        props: {},
        requireAuth: false,
        onStart: vi.fn().mockResolvedValue(undefined),
        onDisable: vi.fn().mockResolvedValue(undefined),
        onEnable: vi.fn().mockResolvedValue(undefined),
        onRenew: vi.fn().mockResolvedValue(undefined),
        onHandshake: vi.fn().mockResolvedValue({ status: 200 }),
        test: vi.fn(async (context: PayloadContext) => [context.payload]),
        run: vi.fn(overrides?.run ?? (async (context: PayloadContext) => [context.payload])),
    }
    const piece = {
        auth: undefined,
        getContextInfo: () => ({
            version: undefined,
        }),
        events: undefined,
    }
    return {
        piece,
        pieceTrigger,
    }
}

function createExecuteTriggerParams({
    hookType,
}: {
    hookType: TriggerHookType
}): ExecuteTriggerParams {
    return {
        params: {
            hookType,
            test: hookType === TriggerHookType.TEST,
            flowVersion: createFlowVersion(),
            webhookUrl: 'http://localhost:4200/webhook',
            triggerPayload: createPayload({ marker: 'original' }),
            projectId: 'projectId',
            platformId: 'platformId',
            engineToken: 'engineToken',
            internalApiUrl: 'http://127.0.0.1:3000/',
            publicApiUrl: 'http://127.0.0.1:4200/api/',
            timeoutInSeconds: 10,
        },
        constants: createEngineConstants(),
    }
}

function createEngineConstants(): EngineConstants {
    return generateMockEngineConstants({
        triggerPieceName: '@activepieces/piece-webhook',
    })
}

function createFlowVersion(): FlowVersion {
    return {
        id: 'flowVersionId',
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
        flowId: 'flowId',
        displayName: 'Webhook Flow',
        trigger: {
            name: 'trigger',
            valid: true,
            displayName: 'Catch Webhook',
            type: FlowTriggerType.PIECE,
            lastUpdatedDate: '2024-01-01T00:00:00Z',
            settings: {
                pieceName: '@activepieces/piece-webhook',
                pieceVersion: '1.0.0',
                triggerName: 'catch_webhook',
                input: {
                    authType: 'none',
                },
                propertySettings: {
                    authType: {
                        type: PropertyExecutionType.MANUAL,
                        schema: undefined,
                    },
                },
            },
        },
        updatedBy: null,
        valid: true,
        schemaVersion: null,
        agentIds: [],
        state: FlowVersionState.DRAFT,
        connectionIds: [],
        backupFiles: null,
        notes: [],
    }
}

function createPayload(body: Record<string, unknown>) {
    return {
        body,
        rawBody: body,
        headers: {},
        queryParams: {},
    }
}

function hasPayload(input: unknown): input is PayloadContext {
    return typeof input === 'object'
        && input !== null
        && 'payload' in input
}

type ExecuteTriggerParams = {
    params: ResolvedExecuteTriggerOperation<TriggerHookType>
    constants: EngineConstants
}

type LoadedTriggerOverrides = {
    run?: (context: PayloadContext) => Promise<unknown[]>
}

type PayloadContext = {
    payload: unknown
}
