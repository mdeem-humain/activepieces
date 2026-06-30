import { tryCatchSync } from '@activepieces/core-utils'
import { z } from 'zod'

function parseEnginePluginPackageConfigList({
    value,
    environment,
}: ParseEnginePluginPackageConfigListParams): EnginePluginPackageConfig[] {
    const parsedJson = parseJson({ value })
    const packageConfigs = EnginePluginPackageConfigListSchema.parse(parsedJson)
    const invalidConfig = packageConfigs.find((packageConfig) => {
        return getPackageNameValidationError({
            packageName: packageConfig.packageName,
            environment,
        }) !== undefined
    })

    if (invalidConfig !== undefined) {
        const validationError = getPackageNameValidationError({
            packageName: invalidConfig.packageName,
            environment,
        })
        throw new Error(`Invalid engine plugin package reference "${invalidConfig.packageName}": ${validationError}`)
    }

    return packageConfigs
}

function parseJson({
    value,
}: {
    value: string
}): unknown {
    const parsedJson = tryCatchSync<unknown, SyntaxError>(() => JSON.parse(value))
    if (parsedJson.error !== null) {
        throw new Error('Invalid engine plugin package config JSON')
    }
    return parsedJson.data
}

function getPackageNameValidationError({
    packageName,
    environment,
}: GetPackageNameValidationErrorParams): string | undefined {
    if (packageName.includes(NULL_BYTE)) {
        return 'null bytes are not allowed'
    }
    if (hasUnsupportedScheme({ packageName })) {
        return 'URL schemes are not allowed'
    }
    if (packageName.includes(PARENT_DIRECTORY_SEGMENT)) {
        return 'parent directory segments are not allowed'
    }
    if (isAbsoluteFilePath({ packageName })) {
        return isDevelopmentEnvironment({ environment })
            ? undefined
            : 'absolute file paths are only allowed in development'
    }
    if (packageName.includes(WINDOWS_PATH_SEPARATOR)) {
        return 'path separators are not allowed'
    }
    if (packageName.includes(POSIX_PATH_SEPARATOR) && !isScopedNpmPackageName({ packageName })) {
        return 'path separators are not allowed'
    }
    if (!isValidNpmPackageName({ packageName })) {
        return 'package name must be a scoped or unscoped npm package name'
    }
    return undefined
}

function hasUnsupportedScheme({
    packageName,
}: {
    packageName: string
}): boolean {
    return !WINDOWS_ABSOLUTE_PATH_PATTERN.test(packageName)
        && UNSUPPORTED_PACKAGE_SCHEME_PATTERN.test(packageName)
}

function isAbsoluteFilePath({
    packageName,
}: {
    packageName: string
}): boolean {
    return packageName.startsWith(POSIX_PATH_SEPARATOR) || WINDOWS_ABSOLUTE_PATH_PATTERN.test(packageName)
}

function isDevelopmentEnvironment({
    environment,
}: {
    environment: string
}): boolean {
    return DEVELOPMENT_ENVIRONMENT_VALUES.includes(environment.toLowerCase())
}

function isScopedNpmPackageName({
    packageName,
}: {
    packageName: string
}): boolean {
    return SCOPED_NPM_PACKAGE_NAME_PATTERN.test(packageName)
}

function isValidNpmPackageName({
    packageName,
}: {
    packageName: string
}): boolean {
    return packageName.length <= MAX_NPM_PACKAGE_NAME_LENGTH
        && (
            UNSCOPED_NPM_PACKAGE_NAME_PATTERN.test(packageName)
            || SCOPED_NPM_PACKAGE_NAME_PATTERN.test(packageName)
        )
}

const NULL_BYTE = '\0'
const PARENT_DIRECTORY_SEGMENT = '..'
const POSIX_PATH_SEPARATOR = '/'
const WINDOWS_PATH_SEPARATOR = '\\'
const MAX_NPM_PACKAGE_NAME_LENGTH = 214
const DEFAULT_ENGINE_PLUGIN_HOOK_TIMEOUT_MS = 5000
const DEFAULT_ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS = 30000
const DEVELOPMENT_ENVIRONMENT_VALUES = ['dev', 'development']
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/
const UNSUPPORTED_PACKAGE_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
const UNSCOPED_NPM_PACKAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9._~-]*$/
const SCOPED_NPM_PACKAGE_NAME_PATTERN = /^@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*$/

const ENGINE_PLUGIN_API_VERSION = '2026-07-01'

const EnginePluginPackageFailurePolicySchema = z.enum([
    'fail-startup',
    'skip-plugin',
])

const EnginePluginPackageConfigSchema = z.object({
    packageName: z.string().min(1),
    exportName: z.string().min(1).optional(),
    enabled: z.boolean().default(true),
    failurePolicy: EnginePluginPackageFailurePolicySchema.default('fail-startup'),
    config: z.unknown().optional(),
})

const EnginePluginPackageConfigListSchema = z.array(EnginePluginPackageConfigSchema)

const EnginePluginHookTimeoutConfigSchema = z.object({
    timeoutMs: z.number().int().positive().default(DEFAULT_ENGINE_PLUGIN_HOOK_TIMEOUT_MS),
    maxTimeoutMs: z.number().int().positive().default(DEFAULT_ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS),
}).transform(({ timeoutMs, maxTimeoutMs }) => {
    return {
        timeoutMs: Math.min(timeoutMs, maxTimeoutMs),
        maxTimeoutMs,
    }
})

type ParseEnginePluginPackageConfigListParams = {
    value: string
    environment: string
}

type GetPackageNameValidationErrorParams = {
    packageName: string
    environment: string
}

type EnginePluginApiVersion = typeof ENGINE_PLUGIN_API_VERSION

type EnginePluginFactory = (context: EnginePluginFactoryContext) =>
    EnginePlugin | EnginePlugin[] | Promise<EnginePlugin | EnginePlugin[]>

type EnginePluginFactoryContext = {
    config: unknown
    logger: EnginePluginLogger
    environment: EnginePluginEnvironment
}

type EnginePluginEnvironment = {
    environment: string
    activepiecesVersion?: string
    edition?: string
}

type EnginePluginLogger = {
    debug(message: string): void
    debug(fields: Record<string, unknown>, message?: string): void
    info(message: string): void
    info(fields: Record<string, unknown>, message?: string): void
    warn(message: string): void
    warn(fields: Record<string, unknown>, message?: string): void
    error(message: string): void
    error(fields: Record<string, unknown>, message?: string): void
}

type EnginePluginLifecycleContext = {
    logger: EnginePluginLogger
    environment: EnginePluginEnvironment
}

type EnginePluginHealth = {
    status: 'healthy' | 'unhealthy'
    message?: string
    details?: Record<string, unknown>
}

type EnginePlugin = {
    name: string
    version?: string
    apiVersion: EnginePluginApiVersion
    hookFailurePolicy?: HookFailurePolicy
    pieceInvocationMiddleware?: PieceInvocationMiddleware[]
    onLoad?: (context: EnginePluginLifecycleContext) => Promise<void> | void
    healthCheck?: (context: EnginePluginLifecycleContext) => Promise<EnginePluginHealth> | EnginePluginHealth
}

type EnginePluginPackageConfig = z.infer<typeof EnginePluginPackageConfigSchema>

type EnginePluginPackageFailurePolicy = z.infer<typeof EnginePluginPackageFailurePolicySchema>

type HookFailurePolicy =
    | 'fail-invocation'
    | 'log-and-continue'

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
    runEnvironment?: 'TESTING' | 'PRODUCTION'
    executionType?: 'BEGIN' | 'RESUME'
}

type PieceInvocationBeforeContext<TInput = unknown> = PieceInvocationContext & {
    input?: TInput
    canReplaceInput: boolean
    canReplaceOutput: boolean
}

type PieceInvocationAfterContext<TOutput = unknown> = PieceInvocationContext & {
    output?: TOutput
    error?: unknown
    durationMs: number
    canReplaceInput: boolean
    canReplaceOutput: boolean
}

type PieceInvocationBeforeResult<TInput = unknown> = {
    input?: TInput
}

type PieceInvocationAfterResult<TOutput = unknown> = {
    output?: TOutput
}

type PieceInvocationMatcher =
    | string
    | RegExp
    | { pieceName: string | string[] }
    | { pieceNamePattern: string }
    | ((context: PieceInvocationContext) => boolean)

type PieceInvocationMiddleware<TInput = unknown, TOutput = unknown> = {
    name: string
    match?: PieceInvocationMatcher
    failurePolicy?: HookFailurePolicy
    timeoutMs?: number
    before?: (context: PieceInvocationBeforeContext<TInput>) =>
        PieceInvocationBeforeResult<TInput>
        | Promise<PieceInvocationBeforeResult<TInput> | undefined>
        | undefined
    after?: (context: PieceInvocationAfterContext<TOutput>) =>
        PieceInvocationAfterResult<TOutput>
        | Promise<PieceInvocationAfterResult<TOutput> | undefined>
        | undefined
}

export {
    ENGINE_PLUGIN_API_VERSION,
    EnginePluginHookTimeoutConfigSchema,
    EnginePluginPackageConfigListSchema,
    EnginePluginPackageConfigSchema,
    parseEnginePluginPackageConfigList,
}

export type {
    EnginePlugin,
    EnginePluginApiVersion,
    EnginePluginEnvironment,
    EnginePluginFactory,
    EnginePluginFactoryContext,
    EnginePluginHealth,
    EnginePluginLifecycleContext,
    EnginePluginLogger,
    EnginePluginPackageConfig,
    EnginePluginPackageFailurePolicy,
    HookFailurePolicy,
    PieceInvocationAfterContext,
    PieceInvocationAfterResult,
    PieceInvocationBeforeContext,
    PieceInvocationBeforeResult,
    PieceInvocationContext,
    PieceInvocationMatcher,
    PieceInvocationMiddleware,
    PieceInvocationPhase,
}
