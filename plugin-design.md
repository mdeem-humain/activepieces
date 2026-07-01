# Activepieces Engine Plugins Design

## Status

Draft design for extending the `feat/middleware` branch into an end-to-end Engine Plugin system.

This document intentionally describes the whole plugin capability, not only external package loading. The current branch already adds an engine-local `EnginePlugin` registry and `PieceInvocationMiddleware` runner. This design keeps that model, makes it installable from external packages, and adds the operational pieces needed for production use.

## Problem

The `feat/middleware` branch lets code inside the engine process register middleware around piece-authored callbacks. That is useful, but it is not yet deployable as an extension system:

- Plugins must be imported and registered by Activepieces source code.
- The public plugin contract lives under `packages/server/engine`, so external packages would need to depend on engine internals.
- Worker settings do not carry plugin configuration to sandboxed engine processes.
- The sandbox provisioning path installs pieces and the engine bundle, but not plugin packages.
- There is no startup loader, validation, ordering, health reporting, or timeout policy for plugin hooks.

Pieces already support package-based loading, but pieces are user-facing integrations stored in `piece_metadata` and selected in flows. Engine plugins are different: they are trusted operator-installed runtime extensions that can observe or affect execution globally. They should not be modeled as pieces or installed by ordinary project users.

## Goals

1. Allow a plugin implementation to live in an independent TypeScript package compiled to JavaScript.
2. Load configured plugin packages automatically when each engine process starts.
3. Keep plugin loading deterministic, observable, and fail-safe.
4. Keep the public plugin authoring contract stable and outside `packages/server/engine`.
5. Support the existing `PieceInvocationMiddleware` behavior end-to-end across worker, sandbox, and engine processes.
6. Avoid a database-backed plugin marketplace or runtime installer in the first implementation.
7. Preserve Activepieces multi-tenant boundaries: plugin code may see scoped execution metadata, but Activepieces must not expose unscoped DB access to plugins.

## Non-Goals

- No user-facing plugin marketplace in the first version.
- No per-project or per-flow plugin installation in the first version.
- No hot reloading of plugins in production.
- No dynamic TypeScript execution. Plugin packages must publish compiled JavaScript.
- No plugin access to Activepieces server internals, TypeORM repositories, or Fastify instances.
- No new piece metadata rows for plugins.

## Terminology

- Engine Plugin: a trusted runtime extension package loaded inside the engine process.
- Plugin Package: an npm package or local package dependency that exports one or more Engine Plugins.
- Plugin Loader: engine startup code that imports configured Plugin Packages and registers their Engine Plugins.
- Plugin Registry: the in-memory, process-local registry used by the engine while executing operations.
- Plugin Capability: a typed extension point exposed by an Engine Plugin, initially `pieceInvocationMiddleware`.
- Piece Invocation Middleware: hooks that run before and after piece-authored callbacks such as action `run`, trigger `run`, dynamic property options, auth validation, and metadata extraction.

## Existing Overlap

This design extends existing concepts rather than creating a separate product feature:

- `.agents/features/pieces.md` already documents `PieceInvocationMiddleware` as engine-local middleware around piece callbacks.
- `.agents/features/flow-runs.md` documents the same middleware as part of execution behavior.
- `.agents/features/workers.md` documents the runtime and sandbox provisioning path where plugin configuration must flow.
- There is no existing general plugin package loader, plugin manifest, or production plugin configuration surface.

## Functional Overview

Engine Plugins are configured by the operator and loaded into every engine process before the engine accepts work from the worker socket.

At runtime:

1. The API process validates plugin configuration on startup and includes it in `WorkerSettingsResponse`.
2. The worker receives settings when it connects to the API.
3. The local runtime maps worker settings into `SandboxPoolSettings`.
4. The sandbox pool passes plugin settings into the engine process environment.
5. The engine startup path runs the Plugin Loader before `workerSocket.init()`.
6. The Plugin Loader imports each configured package, validates exported plugin descriptors, and registers them.
7. Engine operations execute normally. When a piece callback is invoked, `runWithPieceInvocationMiddleware()` asks the registry for matching middleware and runs it in deterministic order.

Plugin loading is static for the lifetime of an engine process. A configuration change requires worker/sandbox restart. This is intentional for predictability.

## Plugin Package Contract

External packages should not import `enginePlugins` or self-register. They should export plugin descriptors or a factory. The engine owns registration so there is only one registry instance.

The public TypeScript contract should move to a thin package, preferably `@activepieces/core-execution`, under a path like:

```text
packages/core/execution/src/lib/engine/plugins.ts
```

The engine then imports those types from `@activepieces/core-execution`. External packages compile against the same published contract.

Example plugin package:

```ts
import type { EnginePluginFactory } from '@activepieces/core-execution'

export const enginePlugin: EnginePluginFactory = async ({ config, logger }) => ({
    name: 'acme-observability',
    version: '1.0.0',
    apiVersion: '2026-07-01',
    pieceInvocationMiddleware: [{
        name: 'http-piece-observer',
        match: { pieceName: '@activepieces/piece-http' },
        after: async (context) => {
            logger.info({
                phase: context.phase,
                durationMs: context.durationMs,
                status: context.error ? 'failed' : 'succeeded',
            }, 'Observed piece invocation')
        },
    }],
})
```

Recommended public types:

```ts
export type EnginePluginFactory = (context: EnginePluginFactoryContext) =>
    EnginePlugin | EnginePlugin[] | Promise<EnginePlugin | EnginePlugin[]>

export type EnginePluginFactoryContext = {
    config: unknown
    logger: EnginePluginLogger
    environment: EnginePluginEnvironment
}

export type EnginePlugin = {
    name: string
    version?: string
    apiVersion: EnginePluginApiVersion
    pieceInvocationMiddleware?: PieceInvocationMiddleware[]
    onLoad?: (context: EnginePluginLifecycleContext) => Promise<void> | void
    healthCheck?: (context: EnginePluginLifecycleContext) => Promise<EnginePluginHealth> | EnginePluginHealth
}
```

The exact shape can stay close to the current branch, but adding `version`, `apiVersion`, lifecycle hooks, and a factory context will make external packages maintainable.

## Plugin Package Manifest

The loader should support ordinary npm package entrypoints. A package can export `default`, `enginePlugin`, or `enginePlugins`.

An optional `package.json` field can improve validation:

```json
{
  "name": "@acme/activepieces-plugin",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "activepieces": {
    "kind": "engine-plugin",
    "apiVersion": "2026-07-01",
    "entry": "./dist/index.js"
  },
  "peerDependencies": {
    "@activepieces/core-execution": "^0.3.0"
  }
}
```

The `activepieces` field is optional in the first version, but if present the loader should validate `kind` and `apiVersion`.

## Configuration

Use one explicit JSON environment variable for plugin packages:

```bash
AP_ENGINE_PLUGINS='[
  {
    "packageName": "@acme/activepieces-plugin",
    "exportName": "enginePlugin",
    "enabled": true,
    "failurePolicy": "fail-startup",
    "config": {
      "mode": "observe"
    }
  }
]'
```

Schema:

```ts
type EnginePluginPackageConfig = {
    packageName: string
    exportName?: string
    enabled?: boolean
    failurePolicy?: 'fail-startup' | 'skip-plugin'
    config?: unknown
}
```

Rules:

- `packageName` must be a valid npm package name by default.
- Absolute file paths should be allowed only in development, gated by `ENVIRONMENT === DEVELOPMENT`.
- `exportName` defaults to `default`, then falls back to `enginePlugin`, then `enginePlugins`.
- `enabled` defaults to `true`.
- `failurePolicy` defaults to `fail-startup`.
- Config values are passed only to that plugin's factory and must never be logged verbatim.

This configuration belongs in the app-level system props so the API can validate and distribute it:

- Add `ENGINE_PLUGINS = 'ENGINE_PLUGINS'` to `AppSystemProp`.
- Add validation in `system-validator.ts`.
- Add the parsed value or original JSON string to `WorkerSettingsResponse`.
- Add the field to `SandboxPoolSettings`.
- Pass it to the engine process as `AP_ENGINE_PLUGINS`.

## Startup Flow

### API Startup

The API validates `AP_ENGINE_PLUGINS` at startup using a Zod schema in a core package. Validation should catch malformed JSON and invalid package names before workers begin processing jobs.

The API does not import plugin packages. It only validates configuration shape and propagates it to workers.

### Worker Connection

`machineService.buildSettingsResponse()` should include the plugin config in `WorkerSettingsResponse`. This keeps app and worker behavior aligned and avoids relying on unstructured `SANDBOX_PROPAGATED_ENV_VARS`.

The worker does not import plugin packages. It only passes the config through to the sandbox pool.

### Sandbox Provisioning

For the MVP static-install model, plugin packages are expected to be installed in the worker image or node environment. The sandbox already mounts `/usr/src/node_modules`, so package-name loading can resolve dependencies if the loader uses CommonJS resolution correctly.

The sandbox pool should pass these environment variables to the engine:

- `AP_ENGINE_PLUGINS`: JSON configuration.
- `AP_ACTIVEPIECES_VERSION`: current release version, if available.
- `AP_EDITION`: current edition, if available.

In isolate mode, those env vars must pass the existing environment key/value validation.

### Engine Startup

`packages/server/engine/src/main.ts` should load plugins before opening the worker socket:

```ts
ssrfGuard.install()
await enginePluginLoader.loadFromEnvironment()
workerSocket.init(SANDBOX_ID)
```

Because `main.ts` is currently synchronous, startup should be wrapped in an async `start()` function and unhandled startup failures should log to stderr and exit with a distinct code.

The loader should:

1. Parse `AP_ENGINE_PLUGINS`.
2. Resolve each package using `createRequire()` instead of raw dynamic `import(packageName)`, because the engine bundle runs from `/root/common/main.js` and ESM package-name resolution can ignore `NODE_PATH`.
3. Import or require the resolved entrypoint.
4. Select configured export.
5. If the export is a factory, call it with `{ config, logger, environment }`.
6. Validate the returned plugin descriptors.
7. Register plugins in config order.
8. Run `onLoad` hooks after registration.
9. Emit structured startup logs listing plugin names and versions.

## Package Resolution

Package loading should be conservative:

- Prefer `require.resolve(packageName, { paths })` with explicit paths:
  - `/usr/src/node_modules`
  - `/root/common/node_modules`
  - `process.cwd()/node_modules`
- For CJS modules, load with `require(resolvedPath)`.
- For ESM modules, load with `import(pathToFileURL(resolvedPath).href)`.
- Never concatenate untrusted package names into filesystem paths.
- Reject names containing `..`, path separators, null bytes, or unsupported URL schemes.

This avoids the "different module instance" problem that would happen if external packages imported and registered against their own copy of `@activepieces/engine`.

## Registry Semantics

The registry remains process-local and in-memory.

Registration rules:

- Plugin names must be unique within a process.
- Middleware names must be unique within a plugin.
- Registration order is exactly the order in `AP_ENGINE_PLUGINS`, then the order of middleware arrays inside each plugin.
- The registry is append-only after startup in production.
- `clear()` should remain available only for tests.

The current `enginePlugins` object can remain the internal registry, but exported public types should come from `@activepieces/core-execution`.

## Piece Invocation Middleware

`PieceInvocationMiddleware` remains the first plugin capability.

### Covered Phases

Replaceable phases:

- `action.run`
- `action.test`
- `trigger.run`
- `trigger.test`

Observe-only phases:

- `trigger.onStart`
- `trigger.onEnable`
- `trigger.onDisable`
- `trigger.onRenew`
- `trigger.onHandshake`
- `property.options`
- `property.props`
- `auth.validate`
- `metadata.extract`

### Matching

The current matcher accepts exact piece names, `RegExp`, predicates, or no matcher for global coverage. For external packages, prefer a serializable structured matcher in the public contract:

```ts
type PieceInvocationMatcher =
    | { pieceName?: string | string[] }
    | { pieceNamePattern: string }
    | ((context: PieceInvocationContext) => boolean)
```

Function matchers should still be supported for code packages. Structured matchers are easier to inspect, log, and eventually validate.

Matching should receive the full invocation context, not only `pieceName`, so plugins can scope by phase, action name, platform, or project without doing work in the hook body.

### Context

Current context has useful IDs. It should be extended to include execution metadata that policy and observability plugins commonly need:

```ts
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
    canReplaceInput: boolean
    canReplaceOutput: boolean
}
```

Do not include decrypted connection values, raw app credentials, or unredacted secrets in the middleware context.

### Hook Behavior

`before` hooks run in registration order.

`after` hooks run in reverse registration order.

For replaceable phases:

- `before` may return `{ input }`.
- `after` may return `{ output }` only when the piece invocation succeeded.
- Middleware should return replacement objects rather than mutating the previous object in place.

For observe-only phases:

- Returned replacements are ignored.
- Hooks can still throw if the configured failure policy says hook failures should fail the invocation.

Piece errors remain piece errors. Middleware cannot convert a failed piece invocation into a successful one in the initial design. That keeps retry, failed-step metadata, and existing flow error behavior predictable.

## Failure Policy

There are two separate failure policies.

Startup failure policy:

- `fail-startup`: default. If the package cannot load or validate, the engine exits.
- `skip-plugin`: log an error and continue without that plugin.

Hook failure policy:

```ts
type HookFailurePolicy = 'fail-invocation' | 'log-and-continue'
```

Default: `fail-invocation`.

Policy plugins should use `fail-invocation`. Pure observability plugins can opt into `log-and-continue`.

The failure policy should be declared at middleware level, with plugin-level default:

```ts
type EnginePlugin = {
    hookFailurePolicy?: HookFailurePolicy
    pieceInvocationMiddleware?: PieceInvocationMiddleware[]
}
```

## Timeouts

Middleware currently has no timeout. A plugin hook can hang an execution indefinitely. Add hook timeouts before exposing plugins externally.

Recommended defaults:

- `AP_ENGINE_PLUGIN_HOOK_TIMEOUT_MS=5000`
- Per-middleware override: `timeoutMs?: number`
- Max cap: `AP_ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS`, default 30000

Timeout behavior follows hook failure policy. With `fail-invocation`, timeout fails the piece invocation. With `log-and-continue`, timeout is logged and the next middleware runs.

## Observability

The loader and runner should emit structured logs and wide events for:

- plugin load started
- plugin loaded
- plugin skipped
- plugin load failed
- hook matched
- hook completed
- hook failed
- hook timed out

Minimum fields:

- plugin name
- plugin version
- middleware name
- phase
- piece name
- piece version
- platformId
- projectId
- flowRunId
- durationMs
- status
- failure policy

Worker-visible loaded plugin metadata is deferred from the first implementation. The long-lived worker does not currently know the in-process engine registry inside each sandbox, and reporting configured package names would not prove what actually loaded. A later design can add executor-to-worker reporting for metadata shaped like:

```ts
enginePlugins: {
    name: string
    version?: string
    apiVersion: string
}[]
```

This would be useful for support and rolling deploy debugging once it can reflect actual engine-loaded descriptors.

## Security Model

Engine plugins are trusted deployment-time code. They are equivalent to code added to the worker image.

Security rules:

- Only operators can configure plugins.
- Project users and ordinary platform admins cannot upload arbitrary plugin code in the first version.
- Plugin package names are validated.
- Plugin code does not receive DB handles or server internals.
- Plugin code receives only scoped execution metadata.
- If future plugin APIs expose storage or HTTP helpers, they must enforce projectId/platformId filtering and SSRF protections.
- Plugin config may contain secrets, so config must be redacted from logs.
- Plugin packages should be pinned by version in the deployment image.

Because plugins can observe and alter execution, a malicious plugin can exfiltrate flow data. This should be documented clearly for self-hosted operators.

## Multi-Tenancy

The plugin system itself is process-scoped, not tenant-scoped. A single worker may process jobs for many platforms and projects.

Therefore:

- Every invocation context must include `platformId` and `projectId` when known.
- Plugins that apply selectively must check those IDs.
- Activepieces must not expose unscoped data access APIs to plugins.
- If a future managed plugin config is stored in the database, every query must filter by `platformId`.

This is a trusted operator feature, but it still needs tenant-aware metadata so plugins can make correct decisions.

## Edition Behavior

Core plugin loading should be available in all editions because it is a self-hosting and deployment capability, not a hosted product feature.

Any UI or database-backed management feature for plugins should be Enterprise/Cloud-gated separately.

Implementation must not import `src/app/ee/` from CE code. If EE needs additional plugin management behavior, use the existing `hooksFactory` pattern.

## Sandbox and Execution Modes

The design must work in all local execution modes:

- `UNSANDBOXED`
- `SANDBOX_CODE_ONLY`
- `SANDBOX_PROCESS`
- `SANDBOX_CODE_AND_PROCESS`

Static package install model:

- The worker image includes plugin packages in `/usr/src/node_modules`.
- The sandbox mounts `/usr/src/node_modules`.
- The engine loader resolves packages through explicit require paths.

Optional cache installer model:

- A future `enginePluginInstaller` can install configured packages into `cache/v*/common/plugins`.
- The sandbox already mounts `common` as `/root/common`.
- The loader can resolve from `/root/common/plugins/node_modules`.
- This should reuse the safety lessons from `pieceInstaller`, especially package-name validation, atomic ready markers, and rollback on failed install.

Do not install plugins into the same `pieces/**` workspace unless they are represented by the same package descriptor type and the path layout is intentionally shared. Plugins are not pieces, so a dedicated `plugins/**` workspace is cleaner.

## Relationship to Pieces

Pieces and Engine Plugins are separate extension types.

Pieces:

- User-facing integrations.
- Stored in `piece_metadata`.
- Can be official or custom.
- Selected inside flows.
- Loaded by piece name/version.
- Safe for platform admins to install because they run through existing piece surfaces and permissions.

Engine Plugins:

- Operator-facing runtime extensions.
- Not stored in `piece_metadata` in the first version.
- Not visible in the piece selector.
- Loaded at engine startup.
- Can affect all flow executions on a worker.
- Trusted like deployed application code.

This separation avoids confusing "plugin" with "piece" and prevents global runtime code from being installed through a user-facing integration catalog.

## Version Compatibility

Add an exported plugin API version:

```ts
export const ENGINE_PLUGIN_API_VERSION = '2026-07-01'
```

Each plugin descriptor must declare `apiVersion`.

The loader rejects plugins with unsupported API versions. A plugin package should also declare a peer dependency on `@activepieces/core-execution`.

This is separate from worker/app version gating. Worker/app version gating prevents mixed Activepieces releases. Plugin API versioning prevents a plugin compiled for one extension contract from silently running against another.

## Suggested File Changes

Core execution:

- `packages/core/execution/src/lib/engine/plugins.ts`
- `packages/core/execution/src/lib/engine/index.ts`
- `packages/core/execution/src/lib/workers/index.ts`

Engine:

- `packages/server/engine/src/lib/plugins/engine-plugin-loader.ts`
- `packages/server/engine/src/lib/plugins/engine-plugins.ts`
- `packages/server/engine/src/lib/plugins/piece-invocation-middleware.ts`
- `packages/server/engine/src/main.ts`

API:

- `packages/server/api/src/app/helper/system/system-props.ts`
- `packages/server/api/src/app/helper/system-validator.ts`
- `packages/server/api/src/app/workers/machine/machine-service.ts`

Worker:

- `packages/server/worker/src/lib/runtime/sandbox-config.ts`

Sandbox pool:

- `packages/server/sandbox-pool/src/lib/types.ts`
- `packages/server/sandbox-pool/src/lib/create-sandbox-for-job.ts`
- Future: `packages/server/sandbox-pool/src/lib/cache/plugins/plugin-installer.ts`

Docs:

- `packages/server/engine/README.md`
- `.agents/features/pieces.md`
- `.agents/features/workers.md`
- Optional new `.agents/features/engine-plugins.md` if plugins become broader than piece invocation middleware.

## Implementation Plan

### Phase 1: Public Contract and Loader

1. Move plugin types to `@activepieces/core-execution`.
2. Update engine imports to use the public types.
3. Implement `enginePluginLoader.loadFromEnvironment()`.
4. Make `main.ts` async and load plugins before socket initialization.
5. Add loader unit tests with CJS and ESM fixture packages.
6. Add duplicate plugin/middleware name validation.

### Phase 2: Settings Propagation

1. Add `ENGINE_PLUGINS` system prop and validator.
2. Add `ENGINE_PLUGINS` to `WorkerSettingsResponse`.
3. Add the field to `SandboxPoolSettings`.
4. Pass `AP_ENGINE_PLUGINS` into sandbox env.
5. Add worker settings and sandbox env tests.

### Phase 3: Middleware Hardening

1. Add hook timeout handling.
2. Add hook failure policy.
3. Add structured matcher support.
4. Extend invocation context with `runEnvironment` and `executionType`.
5. Add tests for replacement behavior, observe-only behavior, timeouts, and failure policies.

### Phase 4: Observability

1. Add load and hook logs.
2. Add wide events around hook duration/status.
3. Document operational troubleshooting.

### Phase 5: Optional Plugin Installer

Only implement this if static image-installed packages are not enough.

1. Add `EnginePluginPackage` descriptor separate from `PiecePackage`.
2. Add plugin package cache under `common/plugins`.
3. Install with `bun` using validated package names and exact versions.
4. Add ready markers and rollback behavior.
5. Decide whether registry packages can come from npm only or also uploaded archives.

## Testing Strategy

Unit tests:

- Loader parses empty config.
- Loader rejects invalid JSON.
- Loader rejects invalid package names.
- Loader loads CJS package export.
- Loader loads ESM package export.
- Loader calls factory with config.
- Loader validates plugin name and API version.
- Registry preserves order.
- Duplicate names fail startup.
- Hook timeout follows failure policy.
- Observe-only phases ignore returned replacements.

Integration tests:

- Worker receives plugin config from API settings.
- Sandbox process gets `AP_ENGINE_PLUGINS`.
- A fixture plugin installed in the test environment wraps `action.run`.
- A fixture plugin works in reusable sandbox mode.
- A fixture plugin works with custom piece mounts.

Regression tests:

- No plugin config keeps current execution behavior unchanged.
- Plugin load failure fails startup by default.
- `skip-plugin` allows startup and logs the skipped plugin.
- Piece errors remain piece errors after middleware observation.

## Additional Features Worth Adding

These are not required for the first implementation, but they are likely to matter once plugins are real.

### Structured Denials

Policy plugins should be able to return a typed denial instead of throwing arbitrary errors:

```ts
return {
    decision: {
        type: 'deny',
        code: 'PIECE_BLOCKED_BY_POLICY',
        message: 'This piece is disabled by platform policy',
    },
}
```

This would let the engine render consistent user-facing errors and audit events.

### Plugin Health Endpoint

Future work can expose loaded plugin metadata and health through worker machine status so operators can confirm a rollout:

- plugin name
- plugin version
- API version
- load time
- latest health status

### Plugin Metrics

Emit counters/histograms:

- plugin hook invocations
- hook duration
- hook failures
- hook timeouts
- matched and skipped invocations

### Operation-Level Hooks

Piece invocation middleware covers pieces, but not all execution behavior. Future capabilities may include:

- before/after engine operation
- before/after step execution
- before/after flow execution
- log redaction hooks
- run tagging hooks

These should be added as separate plugin capabilities, not folded into `PieceInvocationMiddleware`.

### Config Schema Validation

Allow plugins to export a Zod config schema. The loader can validate config before registration:

```ts
export const configSchema = z.object({
    mode: z.enum(['observe', 'enforce']),
})
```

This gives operators fast feedback for malformed plugin config.

### Redaction Contract

Plugins that log context need a helper to redact secrets consistently. Add a small logger wrapper that applies Activepieces redaction rules.

### Development Mode Local Paths

Support local absolute paths only in development. This makes monorepo and local package development easier without opening a production path injection surface.

### Plugin Compatibility Report

At startup, print a compact compatibility report:

```text
Loaded engine plugins:
- acme-observability@1.0.0 api=2026-07-01 package=@acme/activepieces-plugin
```

This helps support diagnose "plugin installed but not active" issues.

## Open Questions

1. Should the first implementation allow `skip-plugin`, or should all configured plugin load failures fail startup?
2. Should `log-and-continue` be available at first, or should all hook failures fail invocation until observability plugins prove the need?
3. Should plugin config support secrets directly, or should secrets only come from environment variables read by the plugin package?
4. Should Cloud support operator-provided plugins at all, or only internally deployed plugins?
5. Should the optional plugin installer support uploaded archives, or only exact npm package versions?

## Recommended First Cut

Implement Phases 1 through 4 with static package installation only.

That gives Activepieces a complete, end-to-end Engine Plugin system without taking on runtime package installation, database entities, UI, or marketplace semantics. It also preserves the current branch's middleware behavior while making external TypeScript packages viable in real deployments.
