import type {
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
} from '@activepieces/core-execution'

type EnginePluginMetadata = {
    name: EnginePlugin['name']
    version: EnginePlugin['version']
    apiVersion: EnginePlugin['apiVersion']
    packageName?: EnginePluginPackageConfig['packageName']
}

type PieceNameMatcher = PieceInvocationMatcher

export type {
    EnginePlugin,
    EnginePluginApiVersion,
    EnginePluginEnvironment,
    EnginePluginFactory,
    EnginePluginFactoryContext,
    EnginePluginHealth,
    EnginePluginLifecycleContext,
    EnginePluginLogger,
    EnginePluginMetadata,
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
    PieceNameMatcher,
}
