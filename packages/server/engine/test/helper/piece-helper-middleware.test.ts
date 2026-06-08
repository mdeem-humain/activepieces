import { PieceAuth, Property, PropertyType } from '@activepieces/pieces-framework'
import { AppConnectionType } from '@activepieces/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pieceHelper } from '../../src/lib/helper/piece-helper'
import { enginePlugins } from '../../src/lib/plugins/engine-plugins'

const { mockGetPropOrThrow, mockLoadPieceOrThrow, mockGetPackageAlias, mockGetPiecePath } = vi.hoisted(() => ({
    mockGetPropOrThrow: vi.fn(),
    mockLoadPieceOrThrow: vi.fn(),
    mockGetPackageAlias: vi.fn(),
    mockGetPiecePath: vi.fn(),
}))

vi.mock('../../src/lib/helper/piece-loader', () => ({
    pieceLoader: {
        getPropOrThrow: mockGetPropOrThrow,
        loadPieceOrThrow: mockLoadPieceOrThrow,
        getPackageAlias: mockGetPackageAlias,
        getPiecePath: mockGetPiecePath,
    },
}))

vi.mock('../../src/lib/variables/props-resolver', () => ({
    createPropsResolver: () => ({
        resolve: vi.fn().mockResolvedValue({
            resolvedInput: {
                mode: 'simple',
            },
        }),
    }),
}))

vi.mock('../../src/lib/handler/context/test-execution-context', () => ({
    testExecutionContext: {
        stateFromFlowVersion: vi.fn().mockResolvedValue({}),
    },
}))

describe('pieceHelper piece invocation middleware', () => {
    beforeEach(() => {
        enginePlugins.clear()
        mockGetPropOrThrow.mockReset()
        mockLoadPieceOrThrow.mockReset()
        mockGetPackageAlias.mockReset()
        mockGetPiecePath.mockReset()
        mockGetPackageAlias.mockReturnValue('@activepieces/piece-test')
        mockGetPiecePath.mockResolvedValue('/tmp/activepieces-test-piece/dist/src/index.js')
    })

    it('wraps dynamic property props callbacks with property.props phase and context metadata', async () => {
        const phases: string[] = []
        const stepNames: Array<string | undefined> = []
        mockGetPropOrThrow.mockResolvedValue({
            property: Property.DynamicProperties({
                displayName: 'Dynamic',
                required: true,
                refreshers: [],
                props: async () => ({
                    value: Property.ShortText({
                        displayName: 'Value',
                        required: false,
                    }),
                }),
            }),
            piece: createPiece(),
        })
        enginePlugins.register({
            name: 'property-props-plugin',
            pieceInvocationMiddleware: [{
                name: 'property-props-middleware',
                before: async ({ phase, pieceName, pieceVersion, projectId, platformId, stepName, actionOrTriggerName }) => {
                    phases.push(`${pieceName}:${pieceVersion}:${phase}:${projectId}:${platformId}`)
                    stepNames.push(stepName, actionOrTriggerName)
                },
            }],
        })

        const result = await pieceHelper.executeProps(createExecutePropsParams({
            propertyName: 'dynamic',
        }))

        expect(result.type).toBe(PropertyType.DYNAMIC)
        expect(phases).toEqual(['@activepieces/piece-test:1.0.0:property.props:projectId:platformId'])
        expect(stepNames).toEqual(['step_name', 'step_name'])
    })

    it.each([
        {
            propertyName: 'dropdown',
            property: Property.Dropdown({
                displayName: 'Dropdown',
                required: false,
                refreshers: [],
                options: async () => ({
                    disabled: false,
                    options: [{ label: 'One', value: 'one' }],
                }),
            }),
            expectedType: PropertyType.DROPDOWN,
        },
        {
            propertyName: 'multi',
            property: Property.MultiSelectDropdown({
                displayName: 'Multi',
                required: false,
                refreshers: [],
                options: async () => ({
                    disabled: false,
                    options: [{ label: 'One', value: 'one' }],
                }),
            }),
            expectedType: PropertyType.MULTI_SELECT_DROPDOWN,
        },
    ])('wraps $propertyName options callbacks with property.options phase', async ({ propertyName, property, expectedType }) => {
        const phases: string[] = []
        mockGetPropOrThrow.mockResolvedValue({
            property,
            piece: createPiece(),
        })
        enginePlugins.register({
            name: 'property-options-plugin',
            pieceInvocationMiddleware: [{
                name: 'property-options-middleware',
                before: async ({ phase }) => {
                    phases.push(phase)
                },
            }],
        })

        const result = await pieceHelper.executeProps(createExecutePropsParams({ propertyName }))

        expect(result.type).toBe(expectedType)
        expect(phases).toEqual(['property.options'])
    })

    it('keeps disabled-options fallback when a wrapped property callback throws', async () => {
        const errors: unknown[] = []
        mockGetPropOrThrow.mockResolvedValue({
            property: Property.Dropdown({
                displayName: 'Dropdown',
                required: false,
                refreshers: [],
                options: async () => {
                    throw new Error('options failed')
                },
            }),
            piece: createPiece(),
        })
        enginePlugins.register({
            name: 'property-error-plugin',
            pieceInvocationMiddleware: [{
                name: 'property-error-middleware',
                after: async ({ error }) => {
                    errors.push(error)
                },
            }],
        })

        const result = await pieceHelper.executeProps(createExecutePropsParams({
            propertyName: 'dropdown',
        }))

        expect(errors).toHaveLength(1)
        expect(result).toEqual({
            type: PropertyType.DROPDOWN,
            options: {
                disabled: true,
                options: [],
                placeholder: 'Throws an error, reconnect or refresh the page',
            },
        })
    })

    it('wraps auth validate callbacks and skips middleware when no validate callback exists', async () => {
        const phases: string[] = []
        const validate = vi.fn().mockResolvedValue({ valid: true })
        mockLoadPieceOrThrow.mockResolvedValueOnce(createPiece({
            auth: PieceAuth.SecretText({
                displayName: 'Secret',
                required: true,
                validate,
            }),
        }))
        mockLoadPieceOrThrow.mockResolvedValueOnce(createPiece({
            auth: PieceAuth.SecretText({
                displayName: 'Secret',
                required: true,
            }),
        }))
        enginePlugins.register({
            name: 'auth-plugin',
            pieceInvocationMiddleware: [{
                name: 'auth-middleware',
                before: async ({ phase }) => {
                    phases.push(phase)
                },
            }],
        })

        const firstResult = await pieceHelper.executeValidateAuth({
            params: createValidateAuthParams(),
            devPieces: [],
        })
        const secondResult = await pieceHelper.executeValidateAuth({
            params: createValidateAuthParams(),
            devPieces: [],
        })

        expect(firstResult).toEqual({ valid: true })
        expect(secondResult).toEqual({ valid: true })
        expect(validate).toHaveBeenCalledTimes(1)
        expect(phases).toEqual(['auth.validate'])
    })

    it('wraps metadata extraction callbacks', async () => {
        const phases: string[] = []
        mockLoadPieceOrThrow.mockResolvedValue(createPiece({
            metadata: () => ({
                name: '@activepieces/piece-test',
                displayName: 'Test',
                description: 'Test piece',
                version: '0.0.0',
                actions: {},
                triggers: {},
                authors: [],
                categories: [],
                logoUrl: 'https://example.com/logo.svg',
                auth: undefined,
                minimumSupportedRelease: '0.0.0',
            }),
        }))
        enginePlugins.register({
            name: 'metadata-plugin',
            pieceInvocationMiddleware: [{
                name: 'metadata-middleware',
                before: async ({ phase }) => {
                    phases.push(phase)
                },
            }],
        })

        const result = await pieceHelper.extractPieceMetadata({
            devPieces: [],
            params: {
                pieceName: '@activepieces/piece-test',
                pieceVersion: '1.0.0',
                platformId: 'platformId',
            },
        })

        expect(result.name).toBe('@activepieces/piece-test')
        expect(result.version).toBe('1.0.0')
        expect(phases).toEqual(['metadata.extract'])
    })
})

function createPiece(overrides?: Partial<TestPiece>) {
    return {
        auth: undefined,
        authors: [],
        getContextInfo: () => ({
            version: undefined,
        }),
        metadata: () => ({
            name: '@activepieces/piece-test',
            displayName: 'Test',
            description: 'Test piece',
            version: '1.0.0',
            actions: {},
            triggers: {},
            authors: [],
            categories: [],
            logoUrl: 'https://example.com/logo.svg',
            auth: undefined,
            minimumSupportedRelease: '0.0.0',
        }),
        ...overrides,
    }
}

function createExecutePropsParams({
    propertyName,
}: {
    propertyName: string
}) {
    return {
        projectId: 'projectId',
        platformId: 'platformId',
        engineToken: 'engineToken',
        internalApiUrl: 'http://127.0.0.1:3000/',
        publicApiUrl: 'http://127.0.0.1:4200/api/',
        timeoutInSeconds: 10,
        pieceName: '@activepieces/piece-test',
        pieceVersion: '1.0.0',
        propertyName,
        actionOrTriggerName: 'step_name',
        input: {},
        sampleData: {},
    }
}

function createValidateAuthParams() {
    return {
        platformId: 'platformId',
        engineToken: 'engineToken',
        internalApiUrl: 'http://127.0.0.1:3000/',
        publicApiUrl: 'http://127.0.0.1:4200/api/',
        timeoutInSeconds: 10,
        piece: {
            pieceName: '@activepieces/piece-test',
            pieceVersion: '1.0.0',
        },
        auth: {
            type: AppConnectionType.SECRET_TEXT,
            secret_text: 'secret',
        },
    }
}

type TestPiece = {
    auth: unknown
    authors: string[]
    getContextInfo: () => { version: undefined }
    metadata: () => Record<string, unknown>
}
