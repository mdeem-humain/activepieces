# engine

## Building

Run `turbo run build --filter=@activepieces/engine` to build the library.

## External Engine Plugins

Engine plugins are operator-installed Node packages loaded by the engine at process startup. They are process-local runtime extensions: the registry is in memory, is not persisted in the database, and is not configured through the API.

Production plugin packages must be statically installed in the app, worker, and sandbox runtime image before startup so Node can resolve them. The engine does not install packages dynamically from `AP_ENGINE_PLUGINS`. Absolute filesystem paths are accepted only when `AP_ENVIRONMENT=development`; production values must be npm package names.

Example `AP_ENGINE_PLUGINS`:

```json
[
    {
        "packageName": "@activepieces/engine-plugin-redact-input-strings",
        "exportName": "enginePlugin",
        "enabled": true,
        "failurePolicy": "fail-startup",
        "config": {
            "pieceNames": ["@activepieces/piece-ai"],
            "rules": [
                {
                    "name": "us-ssn",
                    "pattern": "\\b\\d{3}-\\d{2}-\\d{4}\\b"
                }
            ]
        }
    }
]
```

`packageName` is required. `exportName` selects a named export; if omitted the loader tries `default`, `enginePlugin`, and `enginePlugins` before using the module export. `enabled` defaults to `true`. `failurePolicy` defaults to `fail-startup`; use `skip-plugin` to log and continue when a package cannot be resolved, imported, validated, or loaded. `config` is passed unchanged to plugin factory exports.

See the example plugin at [`packages/plugins/example/redact-input-strings/README.md`](../../plugins/example/redact-input-strings/README.md).

## Package Contract

Plugin packages expose an `EnginePlugin`, an array of `EnginePlugin`, or a factory that receives `{ config, logger, environment }` and returns either shape.

```ts
import {
    ENGINE_PLUGIN_API_VERSION,
    type EnginePluginFactory,
} from '@activepieces/core-execution'

export const enginePlugin: EnginePluginFactory = ({ logger, environment }) => {
    logger.info({ environment }, 'Loading example engine plugin')

    return {
        name: 'example-transform',
        version: '0.1.0',
        apiVersion: ENGINE_PLUGIN_API_VERSION,
        hookFailurePolicy: 'fail-invocation',
        pieceInvocationMiddleware: [{
            name: 'rewrite-http-piece',
            match: { pieceName: '@activepieces/piece-http' },
            timeoutMs: 5000,
            before: async (context) => {
                if (!context.canReplaceInput || context.phase !== 'action.run') {
                    return
                }
                return { input: context.input }
            },
        }],
    }
}
```

Recommended `package.json` metadata:

```json
{
    "name": "@acme/activepieces-engine-plugin",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "activepieces": {
        "kind": "engine-plugin",
        "apiVersion": "2026-07-01"
    }
}
```

## Piece Invocation Middleware

Engine plugins can register middleware around piece-authored callbacks.

```ts
import { enginePlugins } from './src/lib/plugins'

type ActionContextWithProps = {
    propsValue: {
        headers?: Record<string, string>
    }
}

function hasPropsValue(input: unknown): input is ActionContextWithProps {
    return typeof input === 'object' && input !== null && 'propsValue' in input
}

enginePlugins.register({
    name: 'example-transform',
    pieceInvocationMiddleware: [{
        name: 'rewrite-http-piece',
        match: /^@activepieces\/piece-http$/,
        before: async (context) => {
            if (!context.canReplaceInput || context.phase !== 'action.run' || !hasPropsValue(context.input)) {
                return
            }
            return {
                input: {
                    ...context.input,
                    propsValue: {
                        ...context.input.propsValue,
                        headers: {
                            ...context.input.propsValue.headers,
                            'x-ap-middleware': 'enabled',
                        },
                    },
                },
            }
        },
        after: async (context) => {
            if (!context.canReplaceOutput || context.error !== undefined) {
                return
            }
            return {
                output: {
                    value: context.output,
                    middlewareDurationMs: context.durationMs,
                },
            }
        },
    }],
})
```

Middleware matches canonical piece package names such as `@activepieces/piece-http`. `match` can be an exact string, a `RegExp`, or a predicate receiving `{ pieceName }`; omitting `match` makes middleware global.

`before` hooks run in registration order. `after` hooks run in reverse registration order and receive `durationMs`, `output` on success, or `error` on failure. Thrown middleware errors fail the invocation like piece errors. Middleware cannot recover from a piece error; `after` can observe it, then the original error is rethrown.

Middleware must not mutate piece contexts or outputs in place. For `action.run`, `action.test`, `trigger.run`, and `trigger.test`, middleware can return replacement `input` / `output` values. All other phases are observe-only, so returned replacements are ignored.

## Failure And Timeout Policies

Package load failures are controlled by the package config `failurePolicy`: `fail-startup` throws and prevents startup, while `skip-plugin` logs the failure and continues without that package.

Hook failures are controlled by `failurePolicy` on middleware, then `hookFailurePolicy` on the plugin, then the default `fail-invocation`. `fail-invocation` propagates hook errors and timeouts to the piece invocation. `log-and-continue` logs hook errors and timeouts, ignores that hook result, and continues.

Middleware hooks default to `AP_ENGINE_PLUGIN_HOOK_TIMEOUT_MS` (5000 ms) and are capped by `AP_ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS` (30000 ms). A middleware `timeoutMs` can set a lower or higher requested timeout, but it is still capped by the max value.
