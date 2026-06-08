import { enginePlugins } from '../../src/lib/plugins/engine-plugins'
import { runWithPieceInvocationMiddleware } from '../../src/lib/plugins/piece-invocation-middleware'
import { beforeEach, describe, expect, it } from 'vitest'
import type { EnginePlugin } from '../../src/lib/plugins/engine-plugin'
import type {
    PieceInvocationContext,
    PieceInvocationMiddleware,
    PieceInvocationPhase,
} from '../../src/lib/plugins/engine-plugin'

describe('piece invocation middleware', () => {
    beforeEach(() => {
        enginePlugins.clear()
    })

    it('runs middleware without a matcher for every piece', async () => {
        const calls: string[] = []
        enginePlugins.register({
            name: 'global-plugin',
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

    it('runs regex matchers for matching package-style piece names', async () => {
        const calls: string[] = []
        enginePlugins.register({
            name: 'regex-plugin',
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

    it('passes pieceName to predicate matchers so they control matching', async () => {
        const matcherPieceNames: string[] = []
        const calls: string[] = []
        enginePlugins.register({
            name: 'predicate-plugin',
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
}: Partial<PieceInvocationContext> = {}): PieceInvocationContext {
    return {
        pieceName,
        pieceVersion,
        phase,
    }
}

function pluginWithMiddleware(
    middleware: PieceInvocationMiddleware,
): EnginePlugin {
    return {
        name: `${middleware.name}-plugin`,
        pieceInvocationMiddleware: [middleware],
    }
}
