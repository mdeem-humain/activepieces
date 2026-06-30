import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
    ENGINE_PLUGIN_API_VERSION,
    parseEnginePluginPackageConfigList,
} from '@activepieces/core-execution'
import { tryCatch, tryCatchSync } from '@activepieces/core-utils'
import type {
    EnginePlugin,
    EnginePluginEnvironment,
    EnginePluginFactoryContext,
    EnginePluginHealth,
    EnginePluginLogger,
    EnginePluginPackageConfig,
    HookFailurePolicy,
    PieceInvocationAfterContext,
    PieceInvocationAfterResult,
    PieceInvocationBeforeContext,
    PieceInvocationBeforeResult,
    PieceInvocationContext,
    PieceInvocationMatcher,
    PieceInvocationMiddleware,
} from './engine-plugin'
import { enginePlugins } from './engine-plugins'

async function load(): Promise<void> {
    const environment = createEnginePluginEnvironment()
    const packageConfigs = parseEnginePluginPackageConfigList({
        value: process.env.AP_ENGINE_PLUGINS ?? DEFAULT_ENGINE_PLUGIN_PACKAGE_CONFIG,
        environment: environment.environment,
    })
    const logger = createEnginePluginLogger()

    for (const packageConfig of packageConfigs) {
        if (packageConfig.enabled === false) {
            continue
        }
        await loadPackageConfig({
            packageConfig,
            environment,
            logger,
        })
    }
}

async function loadPackageConfig({
    packageConfig,
    environment,
    logger,
}: {
    packageConfig: EnginePluginPackageConfig
    environment: EnginePluginEnvironment
    logger: EnginePluginLogger
}): Promise<void> {
    const loadResult = await tryCatch<EnginePlugin[], unknown>(() => loadPackagePlugins({
        packageConfig,
        environment,
        logger,
    }))

    if (loadResult.error === null) {
        if (loadResult.data === null) {
            throw new Error(`Engine plugin package "${packageConfig.packageName}" loaded without plugin descriptors`)
        }
        await registerLoadedPlugins({
            plugins: loadResult.data,
            packageName: packageConfig.packageName,
            environment,
            logger,
        })
        return
    }

    handlePackageLoadFailure({
        packageConfig,
        logger,
        error: loadResult.error,
    })
}

async function loadPackagePlugins({
    packageConfig,
    environment,
    logger,
}: {
    packageConfig: EnginePluginPackageConfig
    environment: EnginePluginEnvironment
    logger: EnginePluginLogger
}): Promise<EnginePlugin[]> {
    const resolvedPath = resolveEnginePluginPackage({
        packageName: packageConfig.packageName,
    })

    validatePackageManifest({
        packageName: packageConfig.packageName,
        resolvedPath,
    })

    const loadedModule = await loadModule({
        resolvedPath,
    })
    const selectedExport = selectPluginExport({
        loadedModule,
        packageConfig,
    })
    const pluginDescriptors = await resolvePluginDescriptors({
        selectedExport,
        packageConfig,
        environment,
        logger,
    })

    return pluginDescriptors.map((pluginDescriptor, pluginIndex) => validatePluginDescriptor({
        pluginDescriptor,
        packageName: packageConfig.packageName,
        pluginIndex,
    }))
}

async function registerLoadedPlugins({
    plugins,
    packageName,
    environment,
    logger,
}: {
    plugins: EnginePlugin[]
    packageName: string
    environment: EnginePluginEnvironment
    logger: EnginePluginLogger
}): Promise<void> {
    for (const plugin of plugins) {
        enginePlugins.register({
            plugin,
            packageName,
        })
        logger.info({
            packageName,
            pluginName: plugin.name,
        }, 'Registered engine plugin')
        await plugin.onLoad?.({
            logger,
            environment,
        })
    }
}

function handlePackageLoadFailure({
    packageConfig,
    logger,
    error,
}: {
    packageConfig: EnginePluginPackageConfig
    logger: EnginePluginLogger
    error: unknown
}): void {
    if (packageConfig.failurePolicy === 'skip-plugin') {
        logger.warn({
            packageName: packageConfig.packageName,
            errorName: getErrorName({ error }),
        }, 'Skipping failed engine plugin package')
        return
    }
    throw error
}

function resolveEnginePluginPackage({
    packageName,
}: {
    packageName: string
}): string {
    const resolveResult = tryCatchSync<string, unknown>(() => enginePluginRequire.resolve(packageName, {
        paths: getEnginePluginSearchPaths(),
    }))

    if (resolveResult.error !== null) {
        throw new Error(`Failed to resolve engine plugin package "${packageName}"`)
    }
    if (resolveResult.data === null) {
        throw new Error(`Failed to resolve engine plugin package "${packageName}"`)
    }

    return resolveResult.data
}

async function loadModule({
    resolvedPath,
}: {
    resolvedPath: string
}): Promise<unknown> {
    const requireResult = tryCatchSync<unknown, unknown>(() => enginePluginRequire(resolvedPath))

    if (requireResult.error === null) {
        return requireResult.data
    }

    if (!isRequireEsmError({ error: requireResult.error })) {
        throw requireResult.error
    }

    const importResult = await tryCatch<unknown, unknown>(() => import(pathToFileURL(resolvedPath).href))
    if (importResult.error !== null) {
        throw importResult.error
    }
    return importResult.data
}

function selectPluginExport({
    loadedModule,
    packageConfig,
}: {
    loadedModule: unknown
    packageConfig: EnginePluginPackageConfig
}): unknown {
    if (packageConfig.exportName !== undefined) {
        if (!isRecord(loadedModule)) {
            throw new Error(`Engine plugin package "${packageConfig.packageName}" does not expose export "${packageConfig.exportName}"`)
        }
        if (!hasOwnProperty({
            record: loadedModule,
            propertyName: packageConfig.exportName,
        })) {
            throw new Error(`Engine plugin package "${packageConfig.packageName}" does not expose export "${packageConfig.exportName}"`)
        }
        return loadedModule[packageConfig.exportName]
    }

    if (isRecord(loadedModule)) {
        const fallbackExport = DEFAULT_PLUGIN_EXPORT_NAMES
            .map((exportName) => loadedModule[exportName])
            .find((exportValue) => exportValue !== undefined)

        if (fallbackExport !== undefined) {
            return fallbackExport
        }
    }

    return loadedModule
}

async function resolvePluginDescriptors({
    selectedExport,
    packageConfig,
    environment,
    logger,
}: {
    selectedExport: unknown
    packageConfig: EnginePluginPackageConfig
    environment: EnginePluginEnvironment
    logger: EnginePluginLogger
}): Promise<unknown[]> {
    const resolvedExport = isUnknownFunction(selectedExport)
        ? await callPluginFactory({
            factory: selectedExport,
            packageConfig,
            environment,
            logger,
        })
        : selectedExport

    return Array.isArray(resolvedExport) ? resolvedExport : [resolvedExport]
}

async function callPluginFactory({
    factory,
    packageConfig,
    environment,
    logger,
}: {
    factory: UnknownFunction
    packageConfig: EnginePluginPackageConfig
    environment: EnginePluginEnvironment
    logger: EnginePluginLogger
}): Promise<unknown> {
    const context: EnginePluginFactoryContext = {
        config: packageConfig.config,
        logger,
        environment,
    }
    return factory(context)
}

function validatePluginDescriptor({
    pluginDescriptor,
    packageName,
    pluginIndex,
}: {
    pluginDescriptor: unknown
    packageName: string
    pluginIndex: number
}): EnginePlugin {
    if (!isRecord(pluginDescriptor)) {
        throw new Error(`Engine plugin descriptor from "${packageName}" at index ${pluginIndex} must be an object`)
    }

    const name = getRequiredStringProperty({
        record: pluginDescriptor,
        propertyName: 'name',
        packageName,
        pluginIndex,
    })
    const apiVersion = getRequiredStringProperty({
        record: pluginDescriptor,
        propertyName: 'apiVersion',
        packageName,
        pluginIndex,
    })

    if (apiVersion !== ENGINE_PLUGIN_API_VERSION) {
        throw new Error(`Engine plugin "${name}" from "${packageName}" uses unsupported apiVersion "${apiVersion}"`)
    }

    return buildValidatedPlugin({
        pluginDescriptor,
        name,
        packageName,
        pluginIndex,
    })
}

function buildValidatedPlugin({
    pluginDescriptor,
    name,
    packageName,
    pluginIndex,
}: {
    pluginDescriptor: Record<string, unknown>
    name: string
    packageName: string
    pluginIndex: number
}): EnginePlugin {
    const version = getOptionalStringProperty({
        record: pluginDescriptor,
        propertyName: 'version',
        packageName,
        pluginIndex,
    })
    const hookFailurePolicy = getOptionalHookFailurePolicy({
        record: pluginDescriptor,
        propertyName: 'hookFailurePolicy',
        packageName,
        pluginIndex,
    })
    const pieceInvocationMiddleware = getOptionalMiddleware({
        record: pluginDescriptor,
        packageName,
        pluginIndex,
    })
    const onLoad = getOptionalLifecycleHook({
        record: pluginDescriptor,
        propertyName: 'onLoad',
        packageName,
        pluginIndex,
    })
    const healthCheck = getOptionalHealthCheck({
        record: pluginDescriptor,
        packageName,
        pluginIndex,
    })

    return {
        name,
        apiVersion: ENGINE_PLUGIN_API_VERSION,
        ...(version === undefined ? {} : { version }),
        ...(hookFailurePolicy === undefined ? {} : { hookFailurePolicy }),
        ...(pieceInvocationMiddleware === undefined ? {} : { pieceInvocationMiddleware }),
        ...(onLoad === undefined ? {} : { onLoad }),
        ...(healthCheck === undefined ? {} : { healthCheck }),
    }
}

function getOptionalMiddleware({
    record,
    packageName,
    pluginIndex,
}: {
    record: Record<string, unknown>
    packageName: string
    pluginIndex: number
}): PieceInvocationMiddleware[] | undefined {
    const value = record.pieceInvocationMiddleware
    if (value === undefined) {
        return undefined
    }
    if (!Array.isArray(value)) {
        throw new Error(`Engine plugin descriptor from "${packageName}" at index ${pluginIndex} must define pieceInvocationMiddleware as an array`)
    }
    return value.map((middlewareDescriptor, middlewareIndex) => validateMiddlewareDescriptor({
        middlewareDescriptor,
        packageName,
        pluginIndex,
        middlewareIndex,
    }))
}

function validateMiddlewareDescriptor({
    middlewareDescriptor,
    packageName,
    pluginIndex,
    middlewareIndex,
}: {
    middlewareDescriptor: unknown
    packageName: string
    pluginIndex: number
    middlewareIndex: number
}): PieceInvocationMiddleware {
    if (!isRecord(middlewareDescriptor)) {
        throw new Error(`Engine plugin middleware from "${packageName}" at plugin index ${pluginIndex} middleware index ${middlewareIndex} must be an object`)
    }

    const name = getRequiredStringProperty({
        record: middlewareDescriptor,
        propertyName: 'name',
        packageName,
        pluginIndex,
    })
    const match = getOptionalMatcher({
        middlewareDescriptor,
        packageName,
        pluginIndex,
        middlewareIndex,
    })
    const failurePolicy = getOptionalHookFailurePolicy({
        record: middlewareDescriptor,
        propertyName: 'failurePolicy',
        packageName,
        pluginIndex,
    })
    const timeoutMs = getOptionalPositiveNumberProperty({
        record: middlewareDescriptor,
        propertyName: 'timeoutMs',
        packageName,
        pluginIndex,
    })
    const before = getOptionalBeforeHook({
        middlewareDescriptor,
        packageName,
        pluginIndex,
        middlewareIndex,
    })
    const after = getOptionalAfterHook({
        middlewareDescriptor,
        packageName,
        pluginIndex,
        middlewareIndex,
    })

    return {
        name,
        ...(match === undefined ? {} : { match }),
        ...(failurePolicy === undefined ? {} : { failurePolicy }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(before === undefined ? {} : { before }),
        ...(after === undefined ? {} : { after }),
    }
}

function getOptionalMatcher({
    middlewareDescriptor,
    packageName,
    pluginIndex,
    middlewareIndex,
}: {
    middlewareDescriptor: Record<string, unknown>
    packageName: string
    pluginIndex: number
    middlewareIndex: number
}): PieceInvocationMatcher | undefined {
    const value = middlewareDescriptor.match
    if (value === undefined) {
        return undefined
    }
    if (typeof value === 'string' || value instanceof RegExp) {
        return value
    }
    if (isUnknownFunction(value)) {
        return createMatcherFunction({
            matcher: value,
            packageName,
            pluginIndex,
            middlewareIndex,
        })
    }
    if (isRecord(value)) {
        return validateMatcherObject({
            match: value,
            packageName,
            pluginIndex,
            middlewareIndex,
        })
    }
    throw new Error(`Engine plugin middleware match from "${packageName}" at plugin index ${pluginIndex} middleware index ${middlewareIndex} is invalid`)
}

function createMatcherFunction({
    matcher,
    packageName,
    pluginIndex,
    middlewareIndex,
}: {
    matcher: UnknownFunction
    packageName: string
    pluginIndex: number
    middlewareIndex: number
}): (context: PieceInvocationContext) => boolean {
    return (context) => {
        const result = matcher(context)
        if (typeof result !== 'boolean') {
            throw new Error(`Engine plugin middleware match from "${packageName}" at plugin index ${pluginIndex} middleware index ${middlewareIndex} must return a boolean`)
        }
        return result
    }
}

function validateMatcherObject({
    match,
    packageName,
    pluginIndex,
    middlewareIndex,
}: {
    match: Record<string, unknown>
    packageName: string
    pluginIndex: number
    middlewareIndex: number
}): PieceInvocationMatcher {
    if (hasOwnProperty({ record: match, propertyName: 'pieceName' })) {
        const pieceName = match.pieceName
        if (typeof pieceName === 'string') {
            return { pieceName }
        }
        if (Array.isArray(pieceName) && pieceName.every((value) => typeof value === 'string')) {
            return { pieceName }
        }
    }
    if (typeof match.pieceNamePattern === 'string') {
        return { pieceNamePattern: match.pieceNamePattern }
    }
    throw new Error(`Engine plugin middleware match from "${packageName}" at plugin index ${pluginIndex} middleware index ${middlewareIndex} is invalid`)
}

function getOptionalBeforeHook({
    middlewareDescriptor,
    packageName,
    pluginIndex,
    middlewareIndex,
}: {
    middlewareDescriptor: Record<string, unknown>
    packageName: string
    pluginIndex: number
    middlewareIndex: number
}): PieceInvocationMiddleware['before'] {
    const value = middlewareDescriptor.before
    if (value === undefined) {
        return undefined
    }
    if (!isUnknownFunction(value)) {
        throw new Error(`Engine plugin middleware before hook from "${packageName}" at plugin index ${pluginIndex} middleware index ${middlewareIndex} must be a function`)
    }
    return async (context: PieceInvocationBeforeContext<unknown>) => normalizeBeforeHookResult({
        result: await value(context),
        packageName,
        pluginIndex,
        middlewareIndex,
    })
}

function normalizeBeforeHookResult({
    result,
    packageName,
    pluginIndex,
    middlewareIndex,
}: {
    result: unknown
    packageName: string
    pluginIndex: number
    middlewareIndex: number
}): PieceInvocationBeforeResult<unknown> | undefined {
    if (result === undefined) {
        return undefined
    }
    if (!isRecord(result)) {
        throw new Error(`Engine plugin middleware before hook from "${packageName}" at plugin index ${pluginIndex} middleware index ${middlewareIndex} must return an object or undefined`)
    }
    if (hasOwnProperty({ record: result, propertyName: 'input' })) {
        return {
            input: result.input,
        }
    }
    return {}
}

function getOptionalAfterHook({
    middlewareDescriptor,
    packageName,
    pluginIndex,
    middlewareIndex,
}: {
    middlewareDescriptor: Record<string, unknown>
    packageName: string
    pluginIndex: number
    middlewareIndex: number
}): PieceInvocationMiddleware['after'] {
    const value = middlewareDescriptor.after
    if (value === undefined) {
        return undefined
    }
    if (!isUnknownFunction(value)) {
        throw new Error(`Engine plugin middleware after hook from "${packageName}" at plugin index ${pluginIndex} middleware index ${middlewareIndex} must be a function`)
    }
    return async (context: PieceInvocationAfterContext<unknown>) => normalizeAfterHookResult({
        result: await value(context),
        packageName,
        pluginIndex,
        middlewareIndex,
    })
}

function normalizeAfterHookResult({
    result,
    packageName,
    pluginIndex,
    middlewareIndex,
}: {
    result: unknown
    packageName: string
    pluginIndex: number
    middlewareIndex: number
}): PieceInvocationAfterResult<unknown> | undefined {
    if (result === undefined) {
        return undefined
    }
    if (!isRecord(result)) {
        throw new Error(`Engine plugin middleware after hook from "${packageName}" at plugin index ${pluginIndex} middleware index ${middlewareIndex} must return an object or undefined`)
    }
    if (hasOwnProperty({ record: result, propertyName: 'output' })) {
        return {
            output: result.output,
        }
    }
    return {}
}

function getOptionalLifecycleHook({
    record,
    propertyName,
    packageName,
    pluginIndex,
}: {
    record: Record<string, unknown>
    propertyName: string
    packageName: string
    pluginIndex: number
}): EnginePlugin['onLoad'] {
    const value = record[propertyName]
    if (value === undefined) {
        return undefined
    }
    if (!isUnknownFunction(value)) {
        throw new Error(`Engine plugin descriptor from "${packageName}" at index ${pluginIndex} must define ${propertyName} as a function`)
    }
    return async (context) => {
        await value(context)
    }
}

function getOptionalHealthCheck({
    record,
    packageName,
    pluginIndex,
}: {
    record: Record<string, unknown>
    packageName: string
    pluginIndex: number
}): EnginePlugin['healthCheck'] {
    const value = record.healthCheck
    if (value === undefined) {
        return undefined
    }
    if (!isUnknownFunction(value)) {
        throw new Error(`Engine plugin descriptor from "${packageName}" at index ${pluginIndex} must define healthCheck as a function`)
    }
    return async (context) => normalizeHealthCheckResult({
        result: await value(context),
        packageName,
        pluginIndex,
    })
}

function normalizeHealthCheckResult({
    result,
    packageName,
    pluginIndex,
}: {
    result: unknown
    packageName: string
    pluginIndex: number
}): EnginePluginHealth {
    if (!isRecord(result)) {
        throw new Error(`Engine plugin healthCheck from "${packageName}" at index ${pluginIndex} must return an object`)
    }
    if (result.status !== 'healthy' && result.status !== 'unhealthy') {
        throw new Error(`Engine plugin healthCheck from "${packageName}" at index ${pluginIndex} must return a valid status`)
    }
    if (result.message !== undefined && typeof result.message !== 'string') {
        throw new Error(`Engine plugin healthCheck from "${packageName}" at index ${pluginIndex} must return a string message`)
    }
    if (result.details !== undefined && !isRecord(result.details)) {
        throw new Error(`Engine plugin healthCheck from "${packageName}" at index ${pluginIndex} must return object details`)
    }

    return {
        status: result.status,
        ...(result.message === undefined ? {} : { message: result.message }),
        ...(result.details === undefined ? {} : { details: result.details }),
    }
}

function getRequiredStringProperty({
    record,
    propertyName,
    packageName,
    pluginIndex,
}: {
    record: Record<string, unknown>
    propertyName: string
    packageName: string
    pluginIndex: number
}): string {
    const value = record[propertyName]
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Engine plugin descriptor from "${packageName}" at index ${pluginIndex} must define a non-empty string ${propertyName}`)
    }
    return value
}

function getOptionalStringProperty({
    record,
    propertyName,
    packageName,
    pluginIndex,
}: {
    record: Record<string, unknown>
    propertyName: string
    packageName: string
    pluginIndex: number
}): string | undefined {
    const value = record[propertyName]
    if (value === undefined) {
        return undefined
    }
    if (typeof value !== 'string') {
        throw new Error(`Engine plugin descriptor from "${packageName}" at index ${pluginIndex} must define ${propertyName} as a string`)
    }
    return value
}

function getOptionalHookFailurePolicy({
    record,
    propertyName,
    packageName,
    pluginIndex,
}: {
    record: Record<string, unknown>
    propertyName: string
    packageName: string
    pluginIndex: number
}): HookFailurePolicy | undefined {
    const value = record[propertyName]
    if (value === undefined) {
        return undefined
    }
    if (value === 'fail-invocation' || value === 'log-and-continue') {
        return value
    }
    throw new Error(`Engine plugin descriptor from "${packageName}" at index ${pluginIndex} must define a valid ${propertyName}`)
}

function getOptionalPositiveNumberProperty({
    record,
    propertyName,
    packageName,
    pluginIndex,
}: {
    record: Record<string, unknown>
    propertyName: string
    packageName: string
    pluginIndex: number
}): number | undefined {
    const value = record[propertyName]
    if (value === undefined) {
        return undefined
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value
    }
    throw new Error(`Engine plugin descriptor from "${packageName}" at index ${pluginIndex} must define ${propertyName} as a positive number`)
}

function validatePackageManifest({
    packageName,
    resolvedPath,
}: {
    packageName: string
    resolvedPath: string
}): void {
    const packageJsonPath = findNearestPackageJsonPath({
        resolvedPath,
    })

    if (packageJsonPath === undefined) {
        return
    }

    const manifest = readPackageManifest({
        packageJsonPath,
        packageName,
    })

    if (!isRecord(manifest) || manifest.activepieces === undefined) {
        return
    }
    if (!isRecord(manifest.activepieces)) {
        throw new Error(`Engine plugin package "${packageName}" defines invalid activepieces manifest metadata`)
    }
    if (manifest.activepieces.kind !== ENGINE_PLUGIN_MANIFEST_KIND) {
        throw new Error(`Engine plugin package "${packageName}" must define activepieces.kind as "${ENGINE_PLUGIN_MANIFEST_KIND}"`)
    }
    if (
        manifest.activepieces.apiVersion !== undefined
        && manifest.activepieces.apiVersion !== ENGINE_PLUGIN_API_VERSION
    ) {
        throw new Error(`Engine plugin package "${packageName}" manifest uses unsupported apiVersion "${manifest.activepieces.apiVersion}"`)
    }
}

function readPackageManifest({
    packageJsonPath,
    packageName,
}: {
    packageJsonPath: string
    packageName: string
}): unknown {
    const manifestResult = tryCatchSync<unknown, unknown>(() => {
        const packageJsonContents = readFileSync(packageJsonPath, 'utf8')
        const packageJson: unknown = JSON.parse(packageJsonContents)
        return packageJson
    })

    if (manifestResult.error !== null) {
        throw new Error(`Engine plugin package "${packageName}" has an invalid package.json manifest`)
    }

    return manifestResult.data
}

function findNearestPackageJsonPath({
    resolvedPath,
}: {
    resolvedPath: string
}): string | undefined {
    let currentDirectory = path.dirname(resolvedPath)
    const rootDirectory = path.parse(currentDirectory).root

    while (true) {
        const packageJsonPath = path.join(currentDirectory, 'package.json')
        if (existsSync(packageJsonPath)) {
            return packageJsonPath
        }
        if (currentDirectory === rootDirectory) {
            return undefined
        }
        currentDirectory = path.dirname(currentDirectory)
    }
}

function createEnginePluginEnvironment(): EnginePluginEnvironment {
    return {
        environment: process.env.AP_ENVIRONMENT ?? process.env.NODE_ENV ?? DEFAULT_ENGINE_PLUGIN_ENVIRONMENT,
        ...(process.env.AP_ACTIVEPIECES_VERSION === undefined ? {} : { activepiecesVersion: process.env.AP_ACTIVEPIECES_VERSION }),
        ...(process.env.AP_EDITION === undefined ? {} : { edition: process.env.AP_EDITION }),
    }
}

function createEnginePluginLogger(): EnginePluginLogger {
    return {
        debug: logDebug,
        info: logInfo,
        warn: logWarn,
        error: logError,
    }
}

function logDebug(...input: LoggerArguments): void {
    writeConsoleLog({
        consoleMethod: console.debug,
        input,
    })
}

function logInfo(...input: LoggerArguments): void {
    writeConsoleLog({
        consoleMethod: console.info,
        input,
    })
}

function logWarn(...input: LoggerArguments): void {
    writeConsoleLog({
        consoleMethod: console.warn,
        input,
    })
}

function logError(...input: LoggerArguments): void {
    writeConsoleLog({
        consoleMethod: console.error,
        input,
    })
}

function writeConsoleLog({
    consoleMethod,
    input,
}: {
    consoleMethod: ConsoleMethod
    input: LoggerArguments
}): void {
    const [fieldsOrMessage, message] = input
    if (typeof fieldsOrMessage === 'string') {
        consoleMethod(fieldsOrMessage)
        return
    }
    if (message === undefined) {
        consoleMethod(fieldsOrMessage)
        return
    }
    consoleMethod(message, fieldsOrMessage)
}

function getEnginePluginSearchPaths(): string[] {
    return [
        '/usr/src/node_modules',
        '/root/common/node_modules',
        '/root/common/plugins/node_modules',
        path.join(process.cwd(), 'node_modules'),
    ]
}

function isRequireEsmError({
    error,
}: {
    error: unknown
}): boolean {
    return isRecord(error) && error.code === 'ERR_REQUIRE_ESM'
}

function getErrorName({
    error,
}: {
    error: unknown
}): string {
    if (isRecord(error) && typeof error.name === 'string') {
        return error.name
    }
    return 'UnknownError'
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUnknownFunction(value: unknown): value is UnknownFunction {
    return typeof value === 'function'
}

function hasOwnProperty({
    record,
    propertyName,
}: {
    record: Record<string, unknown>
    propertyName: string
}): boolean {
    return Object.prototype.hasOwnProperty.call(record, propertyName)
}

const DEFAULT_ENGINE_PLUGIN_PACKAGE_CONFIG = '[]'
const DEFAULT_ENGINE_PLUGIN_ENVIRONMENT = 'production'
const ENGINE_PLUGIN_MANIFEST_KIND = 'engine-plugin'
const DEFAULT_PLUGIN_EXPORT_NAMES = [
    'default',
    'enginePlugin',
    'enginePlugins',
]
const enginePluginRequire = createRequire(__filename)
const enginePluginLoader = {
    load,
}

type UnknownFunction = (...input: unknown[]) => unknown

type LoggerArguments =
    | [message: string]
    | [fields: Record<string, unknown>, message?: string]

type ConsoleMethod = (...input: unknown[]) => void

export { enginePluginLoader }
