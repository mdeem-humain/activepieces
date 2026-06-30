import path from 'node:path'
import { tryParseFriendlyPieceError } from '@activepieces/core-utils'
import { ExecutionType, FlowAction, FlowRunStatus, RunEnvironment } from '@activepieces/shared'
import { afterEach } from 'vitest'
import { FlowExecutorContext } from '../../src/lib/handler/context/flow-execution-context'
import { flowExecutor } from '../../src/lib/handler/flow-executor'
import { pieceExecutor } from '../../src/lib/handler/piece-executor'
import { enginePluginLoader } from '../../src/lib/plugins'
import { enginePlugins } from '../../src/lib/plugins/engine-plugins'
import { buildPieceAction, generateMockEngineConstants } from './test-helper'

describe('pieceExecutor', () => {
    afterEach(() => {
        enginePlugins.clear()
    })

    it('should execute data mapper successfully', async () => {
        const result = await pieceExecutor.handle({
            action: buildPieceAction({
                name: 'data_mapper',
                pieceName: '@activepieces/piece-data-mapper',
                actionName: 'advanced_mapping',
                input: {
                    mapping: {
                        'key': '{{ 1 + 2 }}',
                    },
                },
            }), executionState: FlowExecutorContext.empty(), constants: generateMockEngineConstants(),
        })
        expect(result.verdict).toStrictEqual({
            status: FlowRunStatus.RUNNING,
        })
        expect(result.steps.data_mapper.output).toEqual({ 'key': 3 })
    })

    it('should execute fail gracefully when pieces fail', async () => {
        const result = await pieceExecutor.handle({
            action: buildPieceAction({
                name: 'send_http',
                pieceName: '@activepieces/piece-http',
                actionName: 'send_request',
                input: {
                    'url': 'https://cloud.activepieces.com/api/v1/asd',
                    'method': 'GET',
                    'headers': {},
                    'body_type': 'none',
                    'body': {},
                    'queryParams': {},
                },
            }), executionState: FlowExecutorContext.empty(), constants: generateMockEngineConstants(),
        })

        const verdict = result.verdict
        expect(verdict.status).toBe(FlowRunStatus.FAILED)
        if (verdict.status !== FlowRunStatus.FAILED) {
            throw new Error('Expected a FAILED verdict')
        }
        expect(verdict.failedStep.name).toBe('send_http')
        expect(verdict.failedStep.displayName).toBe('Your Action Name')

        const failedStepError = tryParseFriendlyPieceError(verdict.failedStep.message)
        expect(failedStepError?.status).toBe(404)
        expect(failedStepError?.apiMessage).toBe('Route not found')

        expect(result.steps.send_http.status).toBe('FAILED')
        const error = tryParseFriendlyPieceError(result.steps.send_http.errorMessage)
        expect(error?.status).toBe(404)
        expect(error?.errorName).toBe('HttpError')
        expect(error?.message).toBe('Route not found')
        expect(error?.apiMessage).toBe('Route not found')
        expect(error?.responseBody).toEqual({
            statusCode: 404,
            error: 'Not Found',
            message: 'Route not found',
        })
    }, 30000)
    it('should skip piece action', async () => {
        const result = await flowExecutor.execute({
            action: buildPieceAction({
                name: 'data_mapper',
                input: {},
                skip: true,
                pieceName: '@activepieces/piece-data-mapper',
                actionName: 'advanced_mapping',
            }), executionState: FlowExecutorContext.empty(), constants: generateMockEngineConstants(),
        })
        expect(result.verdict).toStrictEqual({
            status: FlowRunStatus.RUNNING,
        })
        expect(result.steps.data_mapper).toBeUndefined()
    })
    it('should skip piece action in flow', async () => {
        const flow: FlowAction = {
            ...buildPieceAction({
                name: 'data_mapper',
                input: {
                    mapping: {
                        'key': '{{ 1 + 2 }}',
                    },
                },
                skip: false,
                pieceName: '@activepieces/piece-data-mapper',
                actionName: 'advanced_mapping',
            }),
            nextAction: {
                ...buildPieceAction({
                    name: 'send_http',
                    pieceName: '@activepieces/piece-http',
                    actionName: 'send_request',
                    input: {},
                    skip: true,
                }),
                nextAction: undefined,
            },
        }
        const result = await flowExecutor.execute({
            action: flow, executionState: FlowExecutorContext.empty(), constants: generateMockEngineConstants(),
        })
        expect(result.verdict).toStrictEqual({
            status: FlowRunStatus.RUNNING,
        })
        expect(result.steps.data_mapper.output).toEqual({ 'key': 3 })
        expect(result.steps.send_http).toBeUndefined()
    })

    it('wraps action run with global middleware', async () => {
        const phases: string[] = []
        enginePlugins.register({
            name: 'global-action-plugin',
            pieceInvocationMiddleware: [{
                name: 'global-action-middleware',
                before: async ({ phase }) => {
                    phases.push(phase)
                },
            }],
        })

        const result = await pieceExecutor.handle({
            action: buildDataMapperAction(),
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.verdict).toStrictEqual({
            status: FlowRunStatus.RUNNING,
        })
        expect(phases).toEqual(['action.run'])
    })

    it('passes run environment and execution type to action run middleware context', async () => {
        const contexts: ActionMiddlewareContext[] = []
        enginePlugins.register({
            name: 'action-run-context-plugin',
            pieceInvocationMiddleware: [{
                name: 'action-run-context-middleware',
                before: async ({ phase, runEnvironment, executionType, canReplaceInput, canReplaceOutput }) => {
                    contexts.push({
                        phase,
                        runEnvironment,
                        executionType,
                        canReplaceInput,
                        canReplaceOutput,
                    })
                },
                after: async ({ phase, runEnvironment, executionType, canReplaceInput, canReplaceOutput }) => {
                    contexts.push({
                        phase,
                        runEnvironment,
                        executionType,
                        canReplaceInput,
                        canReplaceOutput,
                    })
                },
            }],
        })

        await pieceExecutor.handle({
            action: buildDataMapperAction(),
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants({
                runEnvironment: RunEnvironment.PRODUCTION,
                executionType: ExecutionType.RESUME,
            }),
        })

        expect(contexts).toEqual([
            {
                phase: 'action.run',
                runEnvironment: RunEnvironment.PRODUCTION,
                executionType: ExecutionType.RESUME,
                canReplaceInput: true,
                canReplaceOutput: true,
            },
            {
                phase: 'action.run',
                runEnvironment: RunEnvironment.PRODUCTION,
                executionType: ExecutionType.RESUME,
                canReplaceInput: true,
                canReplaceOutput: true,
            },
        ])
    })

    it('matches action middleware by exact piece name', async () => {
        const pieceNames: string[] = []
        enginePlugins.register({
            name: 'exact-action-plugin',
            pieceInvocationMiddleware: [{
                name: 'exact-action-middleware',
                match: '@activepieces/piece-data-mapper',
                before: async ({ pieceName }) => {
                    pieceNames.push(pieceName)
                },
            }],
        })

        await pieceExecutor.handle({
            action: buildDataMapperAction(),
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })
        await pieceExecutor.handle({
            action: buildPieceAction({
                name: 'parse_url',
                pieceName: '@activepieces/piece-http',
                actionName: 'parse_url',
                input: {
                    url: 'https://example.com/path?tag=a&tag=b',
                    returnArrays: true,
                },
            }),
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(pieceNames).toEqual(['@activepieces/piece-data-mapper'])
    })

    it('matches action middleware by regex piece name', async () => {
        const pieceNames: string[] = []
        enginePlugins.register({
            name: 'regex-action-plugin',
            pieceInvocationMiddleware: [{
                name: 'regex-action-middleware',
                match: /^@activepieces\/piece-data-/,
                before: async ({ pieceName }) => {
                    pieceNames.push(pieceName)
                },
            }],
        })

        await pieceExecutor.handle({
            action: buildDataMapperAction(),
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(pieceNames).toEqual(['@activepieces/piece-data-mapper'])
    })

    it('allows action run middleware to replace the context passed to the piece', async () => {
        enginePlugins.register({
            name: 'replace-action-input-plugin',
            pieceInvocationMiddleware: [{
                name: 'replace-action-input-middleware',
                match: '@activepieces/piece-data-mapper',
                before: async ({ input, canReplaceInput }) => {
                    expect(canReplaceInput).toBe(true)
                    if (!hasPropsValue(input)) {
                        return
                    }
                    return {
                        input: {
                            ...input,
                            propsValue: {
                                ...input.propsValue,
                                mapping: {
                                    key: 42,
                                },
                            },
                        },
                    }
                },
            }],
        })

        const result = await pieceExecutor.handle({
            action: buildDataMapperAction(),
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.steps.data_mapper.output).toEqual({ key: 42 })
    })

    it('loads an external engine plugin package that redacts data mapper input strings', async () => {
        const originalInput = {
            mapping: {
                ssn: '123-45-6789',
                nested: {
                    message: 'Customer SSN is 123-45-6789',
                },
                items: [
                    'first 123-45-6789',
                    'safe text',
                ],
                label: 'safe text',
                count: 7,
                enabled: true,
                empty: null,
            },
        }

        const result = await withExternalEnginePlugin({
            config: {
                rules: [
                    {
                        name: 'ssn',
                        pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b',
                    },
                ],
            },
            run: () => pieceExecutor.handle({
                action: buildPieceAction({
                    name: 'data_mapper',
                    pieceName: '@activepieces/piece-data-mapper',
                    actionName: 'advanced_mapping',
                    input: originalInput,
                }),
                executionState: FlowExecutorContext.empty(),
                constants: generateMockEngineConstants(),
            }),
        })

        expect(result.verdict).toStrictEqual({
            status: FlowRunStatus.RUNNING,
        })
        expect(result.steps.data_mapper.output).toEqual({
            ssn: 'REDACTED',
            nested: {
                message: 'Customer SSN is REDACTED',
            },
            items: [
                'first REDACTED',
                'safe text',
            ],
            label: 'safe text',
            count: 7,
            enabled: true,
            empty: null,
        })
        expect(originalInput).toEqual({
            mapping: {
                ssn: '123-45-6789',
                nested: {
                    message: 'Customer SSN is 123-45-6789',
                },
                items: [
                    'first 123-45-6789',
                    'safe text',
                ],
                label: 'safe text',
                count: 7,
                enabled: true,
                empty: null,
            },
        })
    })

    it('fails plugin load for malformed external redaction regexp config', async () => {
        await expect(withExternalEnginePlugin({
            config: {
                rules: [
                    {
                        name: 'broken',
                        pattern: '(',
                    },
                ],
            },
            run: () => Promise.resolve(FlowExecutorContext.empty()),
        })).rejects.toThrow()
    })

    it('does not redact when configured pieceNames do not match the piece', async () => {
        const result = await withExternalEnginePlugin({
            config: {
                pieceNames: ['@activepieces/piece-ai'],
                rules: [
                    {
                        name: 'ssn',
                        pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b',
                    },
                ],
            },
            run: () => pieceExecutor.handle({
                action: buildPieceAction({
                    name: 'data_mapper',
                    pieceName: '@activepieces/piece-data-mapper',
                    actionName: 'advanced_mapping',
                    input: {
                        mapping: {
                            ssn: '123-45-6789',
                        },
                    },
                }),
                executionState: FlowExecutorContext.empty(),
                constants: generateMockEngineConstants(),
            }),
        })

        expect(result.steps.data_mapper.output).toEqual({
            ssn: '123-45-6789',
        })
    })

    it('keeps current behavior when the external redaction plugin has no config', async () => {
        const result = await withExternalEnginePlugin({
            run: () => pieceExecutor.handle({
                action: buildPieceAction({
                    name: 'data_mapper',
                    pieceName: '@activepieces/piece-data-mapper',
                    actionName: 'advanced_mapping',
                    input: {
                        mapping: {
                            ssn: '123-45-6789',
                        },
                    },
                }),
                executionState: FlowExecutorContext.empty(),
                constants: generateMockEngineConstants(),
            }),
        })

        expect(result.steps.data_mapper.output).toEqual({
            ssn: '123-45-6789',
        })
    })

    it('allows action run middleware to replace the output stored on the step', async () => {
        enginePlugins.register({
            name: 'replace-action-output-plugin',
            pieceInvocationMiddleware: [{
                name: 'replace-action-output-middleware',
                match: '@activepieces/piece-data-mapper',
                after: async ({ canReplaceOutput, error }) => {
                    expect(canReplaceOutput).toBe(true)
                    expect(error).toBeUndefined()
                    return {
                        output: {
                            wrapped: true,
                        },
                    }
                },
            }],
        })

        const result = await pieceExecutor.handle({
            action: buildDataMapperAction(),
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.steps.data_mapper.output).toEqual({ wrapped: true })
    })

    it('passes action errors to after middleware while preserving failed step behavior', async () => {
        const observedErrors: unknown[] = []
        enginePlugins.register({
            name: 'observe-action-error-plugin',
            pieceInvocationMiddleware: [{
                name: 'observe-action-error-middleware',
                match: '@activepieces/piece-http',
                after: async ({ error }) => {
                    observedErrors.push(error)
                },
            }],
        })

        const result = await pieceExecutor.handle({
            action: buildPieceAction({
                name: 'send_http',
                pieceName: '@activepieces/piece-http',
                actionName: 'send_request',
                input: {
                    'url': 'https://cloud.activepieces.com/api/v1/asd',
                    'method': 'GET',
                    'headers': {},
                    'body_type': 'none',
                    'body': {},
                    'queryParams': {},
                },
            }),
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(observedErrors).toHaveLength(1)
        const verdict = result.verdict
        expect(verdict.status).toBe(FlowRunStatus.FAILED)
        if (verdict.status !== FlowRunStatus.FAILED) {
            throw new Error('Expected a FAILED verdict')
        }
        expect(verdict.failedStep.name).toBe('send_http')
        expect(result.steps.send_http.status).toBe('FAILED')
    }, 30000)

    it('uses action.test phase in single-step test mode when the action defines test', async () => {
        const contexts: ActionMiddlewareContext[] = []
        enginePlugins.register({
            name: 'action-test-plugin',
            pieceInvocationMiddleware: [{
                name: 'action-test-middleware',
                match: '@activepieces/piece-delay',
                before: async ({ phase, runEnvironment, executionType, canReplaceInput, canReplaceOutput }) => {
                    contexts.push({
                        phase,
                        runEnvironment,
                        executionType,
                        canReplaceInput,
                        canReplaceOutput,
                    })
                },
                after: async ({ phase, runEnvironment, executionType, canReplaceInput, canReplaceOutput }) => {
                    contexts.push({
                        phase,
                        runEnvironment,
                        executionType,
                        canReplaceInput,
                        canReplaceOutput,
                    })
                },
            }],
        })

        const result = await pieceExecutor.handle({
            action: buildPieceAction({
                name: 'delay',
                pieceName: '@activepieces/piece-delay',
                actionName: 'delayFor',
                input: {
                    delayFor: 1,
                    unit: 'seconds',
                },
            }),
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants({
                runEnvironment: RunEnvironment.PRODUCTION,
                executionType: ExecutionType.BEGIN,
                stepNameToTest: 'delay',
            }),
        })

        expect(result.verdict).toStrictEqual({
            status: FlowRunStatus.RUNNING,
        })
        expect(result.steps.delay.output).toEqual({
            delayForInMs: 1000,
            success: true,
        })
        expect(contexts).toEqual([
            {
                phase: 'action.test',
                runEnvironment: RunEnvironment.PRODUCTION,
                executionType: ExecutionType.BEGIN,
                canReplaceInput: true,
                canReplaceOutput: true,
            },
            {
                phase: 'action.test',
                runEnvironment: RunEnvironment.PRODUCTION,
                executionType: ExecutionType.BEGIN,
                canReplaceInput: true,
                canReplaceOutput: true,
            },
        ])
    })
})

function buildDataMapperAction() {
    return buildPieceAction({
        name: 'data_mapper',
        pieceName: '@activepieces/piece-data-mapper',
        actionName: 'advanced_mapping',
        input: {
            mapping: {
                key: '{{ 1 + 2 }}',
            },
        },
    })
}

function hasPropsValue(input: unknown): input is ActionContextWithPropsValue {
    return typeof input === 'object'
        && input !== null
        && 'propsValue' in input
}

async function withExternalEnginePlugin<TResult>({
    config,
    run,
}: {
    config?: unknown
    run: () => Promise<TResult>
}): Promise<TResult> {
    const originalApEnginePlugins = process.env.AP_ENGINE_PLUGINS
    const originalApEnvironment = process.env.AP_ENVIRONMENT

    try {
        process.env.AP_ENVIRONMENT = 'development'
        process.env.AP_ENGINE_PLUGINS = JSON.stringify([
            {
                packageName: path.resolve(__dirname, '../fixtures/external-engine-plugin'),
                ...(config === undefined ? {} : { config }),
            },
        ])
        await enginePluginLoader.load()
        return await run()
    }
    finally {
        restoreEnvValue({
            name: 'AP_ENGINE_PLUGINS',
            value: originalApEnginePlugins,
        })
        restoreEnvValue({
            name: 'AP_ENVIRONMENT',
            value: originalApEnvironment,
        })
    }
}

function restoreEnvValue({
    name,
    value,
}: {
    name: string
    value?: string
}): void {
    if (value === undefined) {
        delete process.env[name]
        return
    }
    process.env[name] = value
}

type ActionContextWithPropsValue = {
    propsValue: Record<string, unknown>
}

type ActionMiddlewareContext = {
    phase: string
    runEnvironment?: string
    executionType?: string
    canReplaceInput: boolean
    canReplaceOutput: boolean
}
