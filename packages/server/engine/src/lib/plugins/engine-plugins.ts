import type { EnginePlugin } from './engine-plugin'
import type { PieceInvocationMiddleware } from './piece-invocation-middleware'

const registeredPlugins: EnginePlugin[] = []

function register(plugin: EnginePlugin): void {
    registeredPlugins.push(plugin)
}

function getPieceInvocationMiddleware(): PieceInvocationMiddleware[] {
    return registeredPlugins.flatMap((plugin) => plugin.pieceInvocationMiddleware ?? [])
}

function clear(): void {
    registeredPlugins.splice(0, registeredPlugins.length)
}

export const enginePlugins = {
    register,
    getPieceInvocationMiddleware,
    clear,
}
