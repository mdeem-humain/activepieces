import { enginePlugins } from '../../src/lib/plugins/engine-plugins'
import { runWithPieceInvocationMiddleware } from '../../src/lib/plugins/piece-invocation-middleware'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnginePlugin } from '../../src/lib/plugins/engine-plugin'
import type {
    PieceInvocationContext,
    PieceInvocationMiddleware,
    PieceInvocationPhase,
} from '../../src/lib/plugins/engine-plugin'

describe('piece invocation middleware', () => {
    beforeEach(() => {
        pluginId = 0
        enginePlugins.clear()
        originalHookTimeoutMs = process.env.AP_ENGINE_PLUGIN_HOOK_TIMEOUT_MS
        originalHookMaxTimeoutMs = process.env.AP_ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS
    })

    afterEach(() => {
        restoreEnvValue({
            name: 'AP_ENGINE_PLUGIN_HOOK_TIMEOUT_MS',
            value: originalHookTimeoutMs,
        })
        restoreEnvValue({
            name: 'AP_ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS',
            value: originalHookMaxTimeoutMs,
        })
        vi.restoreAllMocks()
    })

    it('runs middleware without a matcher for every piece', async () => {
        const calls: string[] = []
        enginePlugins.register({
            name: 'global-plugin',
            apiVersion: '2026-07-01',
            pieceInvocationMiddleware: [
                {
                    name: 'global-middleware',
                    before: async ({ pieceName }) => {
                        calls.push(pieceName)
                    },
                },
            ],
        })

        await invokeForPiece({ pieceName: '@activepieces/piece-http' })
        await invokeForPiece({ pieceName: '@custom/piece' })

        expect(calls).toEqual(['@activepieces/piece-http', '@custom/piece'])
    })

    it('runs exact string matchers only for that piece name', async () => {
        const calls: string[] = []
        enginePlugins.register({
            name: 'exact-plugin',
            apiVersion: '2026-07-01',
            pieceInvocationMiddleware: [
                {
                    name: 'exact-middleware',
                    match: '@activepieces/piece-http',
                    before: async ({ pieceName }) => {
                        calls.push(pieceName)
                    },
                },
            ],
        })

        await invokeForPiece({ pieceName: '@activepieces/piece-http' })
        await invokeForPiece({ pieceName: '@activepieces/piece-webhook' })

        expect(calls).toEqual(['@activepieces/piece-http'])
    })

    it('runs structured exact piece name matchers only for that piece name', async () => {
        const calls: string[] = []
        enginePlugins.register({
            name: 'structured-exact-plugin',
            apiVersion: '2026-07-01',
            pieceInvocationMiddleware: [
                {
                    name: 'structured-exact-middleware',
                    match: { pieceName: '@activepieces/piece-http' },
                    before: async ({ pieceName }) => {
                        calls.push(pieceName)
                    },
                },
            ],
        })

        await invokeForPiece({ pieceName: '@activepieces/piece-http' })
        await invokeForPiece({ pieceName: '@activepieces/piece-webhook' })

        expect(calls).toEqual(['@activepieces/piece-http'])
    })

    it('runs structured piece name array matchers for every configured piece name', async () => {
        const calls: string[] = []
        enginePlugins.register({
            name: 'structured-array-plugin',
            apiVersion: '2026-07-01',
            pieceInvocationMiddleware: [
                {
                    name: 'structured-array-middleware',
                    match: {
                        pieceName: [
                            '@activepieces/piece-http',
                            '@activepieces/piece-webhook',
                        ],
                    },
                    before: async ({ pieceName }) => {
                        calls.push(pieceName)
                    },
                },
            ],
        })

        await invokeForPiece({ pieceName: '@activepieces/piece-http' })
        await invokeForPiece({ pieceName: '@activepieces/piece-webhook' })
        await invokeForPiece({ pieceName: '@custom/piece-http' })

        expect(calls).toEqual([
            '@activepieces/piece-http',
            '@activepieces/piece-webhook',
        ])
    })

    it('runs structured pattern matchers for matching piece names', async () => {
        const calls: string[] = []
        enginePlugins.register({
            name: 'structured-pattern-plugin',
            apiVersion: '2026-07-01',
            pieceInvocationMiddleware: [
                {
                    name: 'structured-pattern-middleware',
                    match: { pieceNamePattern: '^@activepieces/piece-' },
                    before: async ({ pieceName }) => {
                        calls.push(pieceName)
                    },
                },
            ],
        })

        await invokeForPiece({ pieceName: '@activepieces/piece-http' })
        await invokeForPiece({ pieceName: '@custom/piece-http' })

        expect(calls).toEqual(['@activepieces/piece-http'])
    })

    it('rejects invalid structured pattern matchers', async () => {
        enginePlugins.register({
            name: 'invalid-pattern-plugin',
            apiVersion: '2026-07-01',
            pieceInvocationMiddleware: [
                {
                    name: 'invalid-pattern-middleware',
                    match: { pieceNamePattern: '[' },
                    before: async () => undefined,
                },
            ],
        })

        await expect(invokeForPiece({ pieceName: '@activepieces/piece-http' }))
            .rejects.toThrow('Invalid pieceNamePattern matcher "["')
    })

    it('runs regex matchers for matching package-style piece names', async () => {
        const calls: string[] = []
        enginePlugins.register({
            name: 'regex-plugin',
            apiVersion: '2026-07-01',
            pieceInvocationMiddleware: [
                {
                    name: 'regex-middleware',
                    match: /^@activepieces\/piece-/,
                    before: async ({ pieceName }) => {
                        calls.push(pieceName)
                    },
                },
            ],
        })

        await invokeForPiece({ pieceName: '@activepieces/piece-http' })
        await invokeForPiece({ pieceName: '@custom/piece-http' })

        expect(calls).toEqual(['@activepieces/piece-http'])
    })

    it('passes the full invocation context to predicate matchers', async () => {
        const matcherContexts: PieceInvocationContext[] = []
        enginePlugins.register({
            name: 'full-context-predicate-plugin',
            apiVersion: '2026-07-01',
            pieceInvocationMiddleware: [
                {
                    name: 'full-context-predicate-middleware',
                    match: (context) => {
                        matcherContexts.push(context)
                        return context.phase === 'action.test'
                            && context.projectId === 'projectId'
                            && context.runEnvironment === 'TESTING'
                            && context.executionType === 'BEGIN'
                    },
                    before: async () => undefined,
                },
            ],
        })

        await runWithPieceInvocationMiddleware({
            context: createContext({
                phase: 'action.test',
                projectId: 'projectId',
                runEnvironment: 'TESTING',
                executionType: 'BEGIN',
            }),
            input: { value: 'input' },
            invoke: async () => ({ value: 'original' }),
        })

        expect(matcherContexts).toEqual([
            {
                pieceName: '@activepieces/piece-http',
                pieceVersion: '1.0.0',
                phase: 'action.test',
                projectId: 'projectId',
                runEnvironment: 'TESTING',
                executionType: 'BEGIN',
            },
        ])
    })

    it('passes pieceName to predicate matchers so they control matching', async () => {
        const matcherPieceNames: string[] = []
        const calls: string[] = []
        enginePlugins.register({
            name: 'predicate-plugin',
            apiVersion: '2026-07-01',
            pieceInvocationMiddleware: [
                {
                    name: 'predicate-middleware',
                    match: ({ pieceName }) => {
                        matcherPieceNames.push(pieceName)
                        return pieceName.endsWith('-http')
                    },
                    before: async ({ pieceName }) => {
                        calls.push(pieceName)
                    },
                },
            ],
        })

        await invokeForPiece({ pieceName: '@activepieces/piece-http' })
        await invokeForPiece({ pieceName: '@activepieces/piece-webhook' })

        expect(matcherPieceNames).toEqual([
            '@activepieces/piece-http',
            '@activepieces/piece-webhook',
        ])
        expect(calls).toEqual(['@activepieces/piece-http'])
    })

    it('does not run non-matching middleware', async () => {
        const calls: string[] = []
        enginePlugins.register({
            name: 'non-match-plugin',
            apiVersion: '2026-07-01',
            pieceInvocationMiddleware: [
                {
                    name: 'non-match-middleware',
                    match: '@activepieces/piece-http',
                    before: async () => {
                        calls.push('before')
                    },
                    after: async () => {
                        calls.push('after')
                    },
                },
            ],
        })

        const output = await invokeForPiece({ pieceName: '@activepieces/piece-webhook' })

        expect(output).toEqual({ value: 'original' })
        expect(calls).toEqual([])
    })

    it('logs matched and completed hooks without input or output values', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
        enginePlugins.register({
            plugin: {
                name: 'structured-log-plugin',
                apiVersion: '2026-07-01',
                pieceInvocationMiddleware: [{
                    name: 'structured-log-middleware',
                    before: async () => undefined,
                }],
            },
            packageName: '@acme/engine-plugin-logs',
        })

        await runWithPieceInvocationMiddleware({
            context: createContext(),
            input: { secret: 'secret-input-value' },
            invoke: async () => ({ secret: 'secret-output-value' }),
        })

        expect(info).toHaveBeenCalledWith(expect.objectContaining({
            packageName: '@acme/engine-plugin-logs',
            pluginName: 'structured-log-plugin',
            middlewareName: 'structured-log-middleware',
            hookName: 'before',
            status: 'matched',
            failurePolicy: 'fail-invocation',
            timeoutMs: expect.any(Number),
        }), 'Piece invocation middleware hook matched')
        expect(info).toHaveBeenCalledWith(expect.objectContaining({
            packageName: '@acme/engine-plugin-logs',
            pluginName: 'structured-log-plugin',
            middlewareName: 'structured-log-middleware',
            hookName: 'before',
            status: 'completed',
            failurePolicy: 'fail-invocation',
            durationMs: expect.any(Number),
        }), 'Piece invocation middleware hook completed')
        expect(JSON.stringify(info.mock.calls)).not.toContain('secret-input-value')
        expect(JSON.stringify(info.mock.calls)).not.toContain('secret-output-value')
    })

    it('runs before hooks in registration order, invokes once, then runs after hooks in reverse order', async () => {
        const events: string[] = []
        enginePlugins.register(pluginWithMiddleware({
            before: async () => {
                events.push('first-before')
            },
            after: async ({ output, durationMs }) => {
                expect(durationMs).toBeGreaterThanOrEqual(0)
                expect(output).toEqual({ value: 'original' })
                events.push('first-after')
            },
        }))
        enginePlugins.register(pluginWithMiddleware({
            before: async () => {
                events.push('second-before')
            },
            after: async ({ output, durationMs }) => {
                expect(durationMs).toBeGreaterThanOrEqual(0)
                expect(output).toEqual({ value: 'original' })
                events.push('second-after')
            },
        }))

        const output = await runWithPieceInvocationMiddleware({
            context: createContext(),
            input: { value: 'input' },
            invoke: async () => {
                events.push('invoke')
                return { value: 'original' }
            },
        })

        expect(output).toEqual({ value: 'original' })
        expect(events).toEqual([
            'first-before',
            'second-before',
            'invoke',
            'second-after',
            'first-after',
        ])
    })

    it('runs every matching after hook with error and rethrows the original error', async () => {
        const events: string[] = []
        const originalError = new Error('boom')
        enginePlugins.register(pluginWithMiddleware({
            before: async () => {
                events.push('first-before')
            },
            after: async ({ error, durationMs }) => {
                expect(error).toBe(originalError)
                expect(durationMs).toBeGreaterThanOrEqual(0)
                events.push('first-after')
            },
        }))
        enginePlugins.register(pluginWithMiddleware({
            before: async () => {
                events.push('second-before')
            },
            after: async ({ error, durationMs }) => {
                expect(error).toBe(originalError)
                expect(durationMs).toBeGreaterThanOrEqual(0)
                events.push('second-after')
            },
        }))

        await expect(runWithPieceInvocationMiddleware({
            context: createContext(),
            input: { value: 'input' },
            invoke: async () => {
                events.push('invoke')
                throw originalError
            },
        })).rejects.toBe(originalError)

        expect(events).toEqual([
            'first-before',
            'second-before',
            'invoke',
            'second-after',
            'first-after',
        ])
    })

    it.each([
        'action.run',
        'action.test',
        'trigger.run',
        'trigger.test',
    ])('passes input replacements through before hooks and into invoke for %s', async (phase: PieceInvocationPhase) => {
        const observedInputs: unknown[] = []
        const firstInput = { value: 'first' }
        const secondInput = { value: 'second' }
        enginePlugins.register(pluginWithMiddleware({
            before: async ({ canReplaceInput }) => {
                expect(canReplaceInput).toBe(true)
                return { input: firstInput }
            },
        }))
        enginePlugins.register(pluginWithMiddleware({
            before: async ({ input, canReplaceInput }) => {
                expect(canReplaceInput).toBe(true)
                observedInputs.push(input)
                return { input: secondInput }
            },
        }))

        await runWithPieceInvocationMiddleware({
            context: createContext({ phase }),
            input: { value: 'original' },
            invoke: async (input) => {
                observedInputs.push(input)
                return { value: 'output' }
            },
        })

        expect(observedInputs).toEqual([firstInput, secondInput])
    })

    it.each([
        'action.run',
        'action.test',
        'trigger.run',
        'trigger.test',
    ])('passes output replacements through after hooks and returns the final output for %s', async (phase: PieceInvocationPhase) => {
        const observedOutputs: unknown[] = []
        const firstOutput = { value: 'first' }
        const secondOutput = { value: 'second' }
        enginePlugins.register(pluginWithMiddleware({
            after: async ({ output, canReplaceOutput }) => {
                expect(canReplaceOutput).toBe(true)
                observedOutputs.push(output)
                return { output: secondOutput }
            },
        }))
        enginePlugins.register(pluginWithMiddleware({
            after: async ({ output, canReplaceOutput }) => {
                expect(canReplaceOutput).toBe(true)
                observedOutputs.push(output)
                return { output: firstOutput }
            },
        }))

        const output = await runWithPieceInvocationMiddleware({
            context: createContext({ phase }),
            input: { value: 'input' },
            invoke: async () => ({ value: 'original' }),
        })

        expect(observedOutputs).toEqual([{ value: 'original' }, firstOutput])
        expect(output).toBe(secondOutput)
    })

    it('ignores input and output replacements for observe-only phases', async () => {
        const observed: unknown[] = []
        enginePlugins.register(pluginWithMiddleware({
            before: async ({ canReplaceInput }) => {
                expect(canReplaceInput).toBe(false)
                return { input: { value: 'ignored-input' } }
            },
            after: async ({ canReplaceOutput }) => {
                expect(canReplaceOutput).toBe(false)
                return { output: { value: 'ignored-output' } }
            },
        }))

        const originalInput = { value: 'original-input' }
        const originalOutput = { value: 'original-output' }
        const output = await runWithPieceInvocationMiddleware({
            context: createContext({ phase: 'property.options' }),
            input: originalInput,
            invoke: async (input) => {
                observed.push(input)
                return originalOutput
            },
        })

        expect(observed).toEqual([originalInput])
        expect(output).toBe(originalOutput)
    })

    it('uses middleware-level failure policy before plugin-level default', async () => {
        const hookError = new Error('middleware override failed')
        enginePlugins.register({
            name: 'failure-policy-override-plugin',
            apiVersion: '2026-07-01',
            hookFailurePolicy: 'log-and-continue',
            pieceInvocationMiddleware: [{
                name: 'failure-policy-override-middleware',
                failurePolicy: 'fail-invocation',
                before: async () => {
                    throw hookError
                },
            }],
        })

        await expect(invokeForPiece({ pieceName: '@activepieces/piece-http' })).rejects.toBe(hookError)
    })

    it('propagates hook failures with the default fail-invocation policy', async () => {
        const hookError = new Error('before failed')
        enginePlugins.register(pluginWithMiddleware({
            before: async () => {
                throw hookError
            },
        }))

        await expect(invokeForPiece({ pieceName: '@activepieces/piece-http' })).rejects.toBe(hookError)
    })

    it('logs hook failures and continues when policy is log-and-continue', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        enginePlugins.register({
            name: 'log-and-continue-plugin',
            apiVersion: '2026-07-01',
            hookFailurePolicy: 'log-and-continue',
            pieceInvocationMiddleware: [{
                name: 'log-and-continue-middleware',
                before: async () => {
                    throw new Error('before failed')
                },
            }],
        })

        const output = await invokeForPiece({ pieceName: '@activepieces/piece-http' })

        expect(output).toEqual({ value: 'original' })
        expect(warn).toHaveBeenCalledWith(expect.objectContaining({
            pluginName: 'log-and-continue-plugin',
            middlewareName: 'log-and-continue-middleware',
            hookName: 'before',
            status: 'failed',
            failurePolicy: 'log-and-continue',
            errorName: 'Error',
            durationMs: expect.any(Number),
        }), 'Piece invocation middleware hook failed')
    })

    it('fails invocation when a hook times out with the default policy', async () => {
        process.env.AP_ENGINE_PLUGIN_HOOK_TIMEOUT_MS = '5'
        enginePlugins.register(pluginWithMiddleware({
            before: async () => new Promise<undefined>(() => undefined),
        }))

        await expect(invokeForPiece({ pieceName: '@activepieces/piece-http' }))
            .rejects.toThrow(/timed out after 5ms/)
    })

    it('logs and continues when a hook times out with log-and-continue policy', async () => {
        process.env.AP_ENGINE_PLUGIN_HOOK_TIMEOUT_MS = '5'
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        enginePlugins.register({
            name: 'timeout-continue-plugin',
            apiVersion: '2026-07-01',
            hookFailurePolicy: 'log-and-continue',
            pieceInvocationMiddleware: [{
                name: 'timeout-continue-middleware',
                before: async () => new Promise<undefined>(() => undefined),
            }],
        })

        const output = await invokeForPiece({ pieceName: '@activepieces/piece-http' })

        expect(output).toEqual({ value: 'original' })
        expect(warn).toHaveBeenCalledWith(expect.objectContaining({
            pluginName: 'timeout-continue-plugin',
            middlewareName: 'timeout-continue-middleware',
            hookName: 'before',
            status: 'timed-out',
            failurePolicy: 'log-and-continue',
            timeoutMs: 5,
            errorName: 'HookTimeoutError',
            durationMs: expect.any(Number),
        }), 'Piece invocation middleware hook timed out')
    })

    it('caps per-middleware timeout with the configured max timeout', async () => {
        process.env.AP_ENGINE_PLUGIN_HOOK_TIMEOUT_MS = '100'
        process.env.AP_ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS = '10'
        enginePlugins.register(pluginWithMiddleware({
            timeoutMs: 500,
            before: async () => new Promise<undefined>(() => undefined),
        }))

        await expect(invokeForPiece({ pieceName: '@activepieces/piece-http' }))
            .rejects.toThrow(/timed out after 10ms/)
    })

    it('does not let after hooks replace a failed piece invocation with success', async () => {
        const originalError = new Error('piece failed')
        enginePlugins.register(pluginWithMiddleware({
            after: async ({ error, canReplaceOutput }) => {
                expect(error).toBe(originalError)
                expect(canReplaceOutput).toBe(true)
                return {
                    output: {
                        value: 'replacement',
                    },
                }
            },
        }))

        await expect(runWithPieceInvocationMiddleware({
            context: createContext(),
            input: { value: 'input' },
            invoke: async () => {
                throw originalError
            },
        })).rejects.toBe(originalError)
    })
})

async function invokeForPiece({
    pieceName,
}: {
    pieceName: string
}): Promise<unknown> {
    return runWithPieceInvocationMiddleware({
        context: createContext({ pieceName }),
        input: { value: 'input' },
        invoke: async () => ({ value: 'original' }),
    })
}

function createContext({
    pieceName = '@activepieces/piece-http',
    pieceVersion = '1.0.0',
    phase = 'action.run',
    ...context
}: Partial<PieceInvocationContext> = {}): PieceInvocationContext {
    return {
        pieceName,
        pieceVersion,
        phase,
        ...context,
    }
}

function pluginWithMiddleware(
    middleware: PieceInvocationMiddleware,
): EnginePlugin {
    const middlewareName = middleware.name ?? `middleware-${pluginId}`
    pluginId += 1

    return {
        name: `${middlewareName}-plugin`,
        apiVersion: '2026-07-01',
        pieceInvocationMiddleware: [{
            ...middleware,
            name: middlewareName,
        }],
    }
}

let pluginId = 0
let originalHookTimeoutMs: string | undefined
let originalHookMaxTimeoutMs: string | undefined

function restoreEnvValue({
    name,
    value,
}: {
    name: string
    value: string | undefined
}): void {
    if (value === undefined) {
        delete process.env[name]
        return
    }
    process.env[name] = value
}
