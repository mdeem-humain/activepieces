import type { EnginePlugin, EnginePluginMetadata, PieceInvocationMiddleware } from './engine-plugin'

const registeredPlugins: RegisteredEnginePlugin[] = []

function register(input: RegisterEnginePluginInput): void {
    const registration = normalizeRegisterInput({ input })
    assertPluginNameIsUnique({ pluginName: registration.plugin.name })
    assertMiddlewareNamesAreUnique({ plugin: registration.plugin })
    registeredPlugins.push({
        plugin: registration.plugin,
        metadata: createEnginePluginMetadata(registration),
    })
}

function getPieceInvocationMiddleware(): PieceInvocationMiddleware[] {
    return registeredPlugins.flatMap((registeredPlugin) => registeredPlugin.plugin.pieceInvocationMiddleware ?? [])
}

function getRegisteredPieceInvocationMiddleware(): RegisteredPieceInvocationMiddleware[] {
    return registeredPlugins.flatMap((registeredPlugin) => {
        return (registeredPlugin.plugin.pieceInvocationMiddleware ?? []).map((middleware) => ({
            pluginName: registeredPlugin.plugin.name,
            pluginHookFailurePolicy: registeredPlugin.plugin.hookFailurePolicy,
            middleware,
        }))
    })
}

function getRegisteredPlugins(): EnginePluginMetadata[] {
    return registeredPlugins.map((registeredPlugin) => ({ ...registeredPlugin.metadata }))
}

function clear(): void {
    registeredPlugins.splice(0, registeredPlugins.length)
}

function normalizeRegisterInput({
    input,
}: {
    input: RegisterEnginePluginInput
}): RegisterEnginePluginParams {
    if (isRegisterEnginePluginParams(input)) {
        return input
    }
    return {
        plugin: input,
    }
}

function isRegisterEnginePluginParams(input: RegisterEnginePluginInput): input is RegisterEnginePluginParams {
    return typeof input === 'object'
        && input !== null
        && 'plugin' in input
}

function assertPluginNameIsUnique({
    pluginName,
}: {
    pluginName: string
}): void {
    const duplicatePlugin = registeredPlugins.find((registeredPlugin) => registeredPlugin.plugin.name === pluginName)
    if (duplicatePlugin !== undefined) {
        throw new Error(`Engine plugin "${pluginName}" is already registered`)
    }
}

function assertMiddlewareNamesAreUnique({
    plugin,
}: {
    plugin: EnginePlugin
}): void {
    const duplicateMiddlewareName = findDuplicateMiddlewareName({ plugin })
    if (duplicateMiddlewareName !== undefined) {
        throw new Error(`Engine plugin "${plugin.name}" defines duplicate piece invocation middleware "${duplicateMiddlewareName}"`)
    }
}

function findDuplicateMiddlewareName({
    plugin,
}: {
    plugin: EnginePlugin
}): string | undefined {
    const seenMiddlewareNames = new Set<string>()
    for (const middleware of plugin.pieceInvocationMiddleware ?? []) {
        if (seenMiddlewareNames.has(middleware.name)) {
            return middleware.name
        }
        seenMiddlewareNames.add(middleware.name)
    }
    return undefined
}

function createEnginePluginMetadata({
    plugin,
    packageName,
}: RegisterEnginePluginParams): EnginePluginMetadata {
    return {
        name: plugin.name,
        version: plugin.version,
        apiVersion: plugin.apiVersion,
        ...(packageName === undefined ? {} : { packageName }),
    }
}

const enginePlugins = {
    register,
    getPieceInvocationMiddleware,
    getRegisteredPieceInvocationMiddleware,
    getRegisteredPlugins,
    clear,
}

type RegisterEnginePluginInput = EnginePlugin | RegisterEnginePluginParams

type RegisterEnginePluginParams = {
    plugin: EnginePlugin
    packageName?: string
}

type RegisteredEnginePlugin = {
    plugin: EnginePlugin
    metadata: EnginePluginMetadata
}

type RegisteredPieceInvocationMiddleware = {
    pluginName: EnginePlugin['name']
    pluginHookFailurePolicy?: EnginePlugin['hookFailurePolicy']
    middleware: PieceInvocationMiddleware
}

export { enginePlugins }
