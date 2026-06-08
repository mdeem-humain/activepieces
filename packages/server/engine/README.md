# engine

## Building

Run `turbo run build --filter=@activepieces/engine` to build the library.

## Piece Invocation Middleware

Engine-local plugins can register middleware around piece-authored callbacks. The registry is in-memory and process-local; it is not persisted in the database and is not configured through the API.

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
