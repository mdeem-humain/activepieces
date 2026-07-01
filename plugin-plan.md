# Activepieces Engine Plugins Implementation Plan

## Source Inputs

- `plugin-design.md` describes the target Engine Plugin system.
- `.agents/features/pieces.md` documents the existing engine-local `PieceInvocationMiddleware`.
- `.agents/features/flow-runs.md` documents how middleware participates in execution behavior.
- `.agents/features/workers.md` documents worker settings, runtime provisioning, and sandbox behavior.
- `.claude/rules/core-packages.md` requires public thin contracts to live in `packages/core/*`, with `@activepieces/core-execution` available to the engine and pieces.

## Existing Functionality To Preserve

- `packages/server/engine/src/lib/plugins/engine-plugin.ts` currently owns engine-local plugin and middleware types.
- `packages/server/engine/src/lib/plugins/engine-plugins.ts` is a simple process-local registry with `register`, `getPieceInvocationMiddleware`, and `clear`.
- `packages/server/engine/src/lib/plugins/piece-invocation-middleware.ts` already supports:
  - global middleware when no matcher is provided,
  - exact string, `RegExp`, and predicate piece matchers,
  - before hooks in registration order,
  - after hooks in reverse registration order,
  - input and output replacement for `action.run`, `action.test`, `trigger.run`, and `trigger.test`,
  - observe-only behavior for trigger lifecycle, dynamic property, auth validation, and metadata extraction phases.
- Existing engine tests cover middleware behavior in:
  - `packages/server/engine/test/plugins/piece-invocation-middleware.test.ts`
  - `packages/server/engine/test/handler/flow-piece.test.ts`
  - `packages/server/engine/test/helper/piece-helper-middleware.test.ts`
  - `packages/server/engine/test/helper/trigger-helper-middleware.test.ts`
- `packages/server/engine/src/main.ts` starts synchronously today: install SSRF guard, set the process title, initialize `workerSocket`, then register process-level fatal handlers.
- `WorkerSettingsResponse` currently lives in `packages/core/execution/src/lib/workers/index.ts` and is re-exported by `@activepieces/shared`.
- `machineService.buildSettingsResponse()` currently builds worker settings once and caches them under a shared key.
- `SandboxPoolSettings` in `packages/server/sandbox-pool/src/lib/types.ts` is a structural subset of `WorkerSettingsResponse`.
- `createSandboxForJob()` already has tests for sandbox env construction in `packages/server/sandbox-pool/test/lib/create-sandbox-for-job.test.ts`.
- There is no existing API route, DB entity, feature flag, or UI surface for general engine plugins. That absence is intentional for the first cut.

## First-Cut Scope

Implement Phases 1 through 4 from `plugin-design.md` with static package installation only:

- public plugin authoring contract in `@activepieces/core-execution`,
- engine startup loader,
- API to worker to sandbox configuration propagation,
- middleware hardening for external packages,
- operator-facing logs and worker health metadata.

Do not implement the optional plugin installer, plugin marketplace, database-backed configuration, UI, per-project installation, or piece metadata integration in the first cut.

## Cross-Cutting Decisions

- Keep Engine Plugins separate from Pieces. Engine Plugins are trusted operator-installed runtime extensions, not rows in `piece_metadata` and not visible in the piece selector.
- Transport `AP_ENGINE_PLUGINS` as a raw JSON string through worker settings and sandbox env. The API validates the JSON at startup, but the engine receives the original compact string so secrets are not expanded or logged by intermediate layers.
- Add a default value of `[]` for `AP_ENGINE_PLUGINS` so existing self-hosted deployments need no new setup.
- Add timeout envs with defaults:
  - `AP_ENGINE_PLUGIN_HOOK_TIMEOUT_MS=5000`
  - `AP_ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS=30000`
- Pass `AP_ENVIRONMENT`, `AP_ACTIVEPIECES_VERSION`, and `AP_EDITION` into the engine process explicitly. `AP_ENVIRONMENT` is needed to gate development-only absolute-path package loading.
- Make plugin loading available in CE, EE, and Cloud runtime code. Any future UI or DB-backed management surface should be Enterprise/Cloud-gated separately.
- Do not import `src/app/ee/` from CE code.
- Do not expose DB handles, TypeORM repositories, Fastify instances, decrypted connections, or unredacted credentials to plugins.
- Do not log plugin `config` values. Treat them as secret-bearing.
- Do not introduce a dependency from `@activepieces/core-execution` to `@activepieces/shared`, server packages, web packages, or piece packages.

## Task 1: Public Contract In `@activepieces/core-execution`

### Implementation

Add `packages/core/execution/src/lib/engine/plugins.ts` with the external plugin contract:

- `ENGINE_PLUGIN_API_VERSION`
- `EnginePluginApiVersion`
- `EnginePluginFactory`
- `EnginePluginFactoryContext`
- `EnginePluginEnvironment`
- `EnginePluginLogger`
- `EnginePluginLifecycleContext`
- `EnginePluginHealth`
- `EnginePlugin`
- `EnginePluginPackageConfig`
- `EnginePluginPackageFailurePolicy`
- `HookFailurePolicy`
- `PieceInvocationPhase`
- `PieceInvocationContext`
- `PieceInvocationBeforeContext`
- `PieceInvocationAfterContext`
- `PieceInvocationBeforeResult`
- `PieceInvocationAfterResult`
- `PieceInvocationMatcher`
- `PieceInvocationMiddleware`

Add Zod schemas in the same file or a directly adjacent `plugin-config.ts`:

- `EnginePluginPackageConfigSchema`
- `EnginePluginPackageConfigListSchema`
- `EnginePluginHookTimeoutConfigSchema` if timeout parsing is centralized.

Use `z.enum`, not `z.nativeEnum`. Keep exported types and constants grouped at the end of the file, matching repo convention.

Update:

- `packages/core/execution/src/lib/engine/index.ts`
- `packages/core/execution/src/index.ts` if needed by the barrel export pattern.
- `packages/core/execution/package.json` version from `0.2.2` to `0.3.0`, because this adds a new public authoring contract.

Do not edit `packages/core/shared` unless it is actually required. If any file under `packages/core/shared` changes, bump `packages/core/shared/package.json` according to the shared package rule.

### Tests

Add `packages/core/execution/test/automation/engine/plugins.test.ts`:

- parses an empty config array,
- applies defaults for `enabled` and `failurePolicy`,
- accepts scoped and unscoped npm package names,
- rejects names with path separators, `..`, null bytes, URLs, and unsupported schemes,
- accepts absolute file paths only when the supplied environment is development,
- rejects malformed JSON through a parse helper,
- validates timeout defaults and max cap.

### Local Verification

- `npx turbo run test --filter=@activepieces/core-execution`
- `npx turbo run lint --filter=@activepieces/core-execution`

## Task 2: Adopt Public Types And Harden The Engine Registry

### Implementation

Update engine plugin code to import public types from `@activepieces/core-execution`:

- `packages/server/engine/src/lib/plugins/engine-plugin.ts`
- `packages/server/engine/src/lib/plugins/piece-invocation-middleware.ts`
- `packages/server/engine/src/lib/plugins/index.ts`

The internal registry in `engine-plugins.ts` should remain process-local and in-memory, but add validation:

- plugin names must be unique,
- middleware names must be unique within each plugin,
- registry order must remain exactly registration order,
- `clear()` remains available for tests.

Add a read method for observability:

- `getRegisteredPlugins(): EnginePluginMetadata[]`

where metadata includes `name`, `version`, `apiVersion`, and package name when known. Do not expose full plugin descriptors through worker health.

### Tests

Extend `packages/server/engine/test/plugins/piece-invocation-middleware.test.ts` or add `engine-plugins.test.ts`:

- duplicate plugin names fail registration,
- duplicate middleware names within one plugin fail registration,
- duplicate middleware names across different plugins are allowed unless the design chooses global uniqueness,
- registration order is preserved after public type adoption,
- `clear()` resets registry state for tests.

### Local Verification

- `npm run test --workspace=packages/server/engine -- test/plugins`
- `npx turbo run lint --filter=@activepieces/engine`

## Task 3: Engine Plugin Loader

### Implementation

Add `packages/server/engine/src/lib/plugins/engine-plugin-loader.ts`.

Loader responsibilities:

- parse `process.env.AP_ENGINE_PLUGINS ?? '[]'` using the shared core-execution schema,
- skip config rows where `enabled === false`,
- validate package names and development-only absolute file paths before resolution,
- resolve packages with `createRequire()` and explicit search paths:
  - `/usr/src/node_modules`,
  - `/root/common/node_modules`,
  - `/root/common/plugins/node_modules` for future installer compatibility,
  - `process.cwd()/node_modules`,
- avoid string-concatenating untrusted package names into paths,
- load CJS with `require(resolvedPath)`,
- load ESM with `import(pathToFileURL(resolvedPath).href)` when CJS require reports ESM,
- support `exportName` when provided,
- otherwise try `default`, `enginePlugin`, then `enginePlugins`,
- support a factory export or direct descriptors,
- call factories with `{ config, logger, environment }`,
- validate returned descriptors,
- reject unsupported `apiVersion`,
- register plugins in config order,
- call `onLoad` after successful registration,
- apply `failurePolicy`:
  - `fail-startup` throws,
  - `skip-plugin` logs and continues.

Use an engine-local logger facade with `info`, `warn`, `error`, and `debug` methods backed by `console.*`. Do not import the API logger or `src/app/*` from the engine.

### Tests

Add fixture packages under `packages/server/engine/test/fixtures/engine-plugins/`:

- CJS default export,
- CJS named `enginePlugin`,
- CJS named `enginePlugins`,
- ESM default export,
- factory receiving config,
- invalid descriptor,
- unsupported API version,
- manifest with `activepieces.kind = "engine-plugin"`,
- manifest with wrong kind,
- package that throws on import.

Add `packages/server/engine/test/plugins/engine-plugin-loader.test.ts`:

- empty env loads no plugins,
- invalid JSON fails,
- invalid package name fails,
- CJS and ESM fixtures load,
- `exportName` selects the exact export,
- fallback export order works,
- factory receives config without logging it,
- unsupported API version fails,
- `skip-plugin` continues after a failed package,
- `fail-startup` fails by default,
- `onLoad` runs after registration,
- loaded plugin metadata is recorded without config.

### Local Verification

- `npm run test --workspace=packages/server/engine -- test/plugins/engine-plugin-loader.test.ts`
- `npm run test --workspace=packages/server/engine -- test/plugins/piece-invocation-middleware.test.ts`

## Task 4: Async Engine Startup

### Implementation

Refactor `packages/server/engine/src/main.ts` into an async startup path:

1. register `uncaughtException` and `unhandledRejection` handlers early,
2. install `ssrfGuard`,
3. set `process.title`,
4. if `SANDBOX_ID` exists, call `await enginePluginLoader.loadFromEnvironment()`,
5. initialize `workerSocket`,
6. initialize `flowRunProgressReporter`.

Startup failures before `workerSocket.init()` cannot reliably send errors to the worker, so log them to stderr and exit with a distinct code, for example `process.exit(7)`.

Keep no-config behavior identical: if `AP_ENGINE_PLUGINS` is unset or `[]`, the engine starts exactly as it does today.

### Tests

Prefer factoring a small `startEngine()` function for unit tests:

- loader runs before `workerSocket.init`,
- no `SANDBOX_ID` does not initialize loader or socket,
- loader startup failure exits with the selected code,
- uncaught/rejection handlers still send errors through `workerSocket.sendError` after socket initialization.

### Local Verification

- `npm run test --workspace=packages/server/engine -- test/plugins`
- `npx turbo run build --filter=@activepieces/engine`

## Task 5: API System Props And Worker Settings

### Implementation

Update system props:

- `packages/server/api/src/app/helper/system/system-props.ts`
  - add `ENGINE_PLUGINS = 'ENGINE_PLUGINS'`,
  - add `ENGINE_PLUGIN_HOOK_TIMEOUT_MS = 'ENGINE_PLUGIN_HOOK_TIMEOUT_MS'`,
  - add `ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS = 'ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS'`.
- `packages/server/api/src/app/helper/system/system.ts`
  - default `ENGINE_PLUGINS` to `[]`,
  - default hook timeout to `5000`,
  - default max hook timeout to `30000`.
- `packages/server/api/src/app/helper/system-validator.ts`
  - validate `ENGINE_PLUGINS` with the core-execution schema,
  - validate timeout values as positive numbers,
  - fail startup for invalid engine plugin config instead of only warning. This can be a targeted strict check after the generic validator so existing warning behavior for other props does not change.

Update worker contract:

- `packages/core/execution/src/lib/workers/index.ts`
  - add `ENGINE_PLUGINS: z.string()`,
  - add `ENGINE_PLUGIN_HOOK_TIMEOUT_MS: z.number()`,
  - add `ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS: z.number()`.

Update API settings builder:

- `packages/server/api/src/app/workers/machine/machine-service.ts`
  - include the raw `ENGINE_PLUGINS` string,
  - include timeout numbers,
  - preserve the current cache behavior unless the implementation needs a test hook to clear it.

### Tests

Extend or add API unit tests:

- `packages/server/api/test/unit/app/workers/machine/machine-service.test.ts`
  - includes `ENGINE_PLUGINS`,
  - includes timeout settings,
  - no env var returns default `[]`.
- Add a validator unit test under `packages/server/api/test/unit/app/helper/`:
  - valid plugin JSON passes,
  - malformed JSON fails startup,
  - invalid package name fails startup,
  - non-positive timeout fails startup,
  - config values are not printed in validation errors.

Extend core worker schema tests if a suitable test file exists, or add one in `packages/core/execution/test/automation/workers/`.

### Local Verification

- `npm run test-unit --workspace=packages/server/api -- test/unit/app/workers/machine/machine-service.test.ts`
- `npm run test-unit --workspace=packages/server/api -- test/unit/app/helper`
- `npx turbo run test --filter=@activepieces/core-execution`

## Task 6: Worker And Sandbox Env Propagation

### Implementation

Update `packages/server/sandbox-pool/src/lib/types.ts` so `SandboxPoolSettings` includes:

- `ENGINE_PLUGINS: string`
- `ENGINE_PLUGIN_HOOK_TIMEOUT_MS: number`
- `ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS: number`
- `APP_VERSION?: string`
- `EDITION: string`

Update `packages/server/sandbox-pool/src/lib/create-sandbox-for-job.ts`:

- set `AP_ENGINE_PLUGINS`,
- set `AP_ENGINE_PLUGIN_HOOK_TIMEOUT_MS`,
- set `AP_ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS`,
- set `AP_ENVIRONMENT`,
- set `AP_ACTIVEPIECES_VERSION` when present,
- set `AP_EDITION`.

Do not rely on `SANDBOX_PROPAGATED_ENV_VARS` for these keys. They are part of the typed runtime contract.

Isolate mode already validates env keys and rejects values containing newlines or NUL bytes. Document that `AP_ENGINE_PLUGINS` must be compact JSON. If operators need multiline secrets, those secrets should live in separate environment variables read by the plugin package, not inside the plugin config JSON.

Update worker tests that construct `WorkerSettingsResponse` fixtures:

- `packages/server/worker/test/lib/worker-settings-override.test.ts`
- any worker tests with local `buildWorkerSettingsResponse()`.

### Tests

Extend `packages/server/sandbox-pool/test/lib/create-sandbox-for-job.test.ts`:

- `AP_ENGINE_PLUGINS` is present and equals the raw JSON string,
- hook timeout envs are present as strings,
- `AP_ENVIRONMENT`, `AP_ACTIVEPIECES_VERSION`, and `AP_EDITION` are present,
- no plugin env config leaks through `SANDBOX_PROPAGATED_ENV_VARS` when the typed settings are empty,
- isolate-compatible values pass existing env validation.

Extend `packages/server/worker/test/lib/worker-settings-override.test.ts`:

- worker settings round-trip preserves `ENGINE_PLUGINS`,
- local `AP_EXECUTION_MODE` override does not drop plugin settings.

### Local Verification

- `npx turbo run test --filter=@activepieces/sandbox-pool`
- `npm run test --workspace=packages/server/worker -- test/lib/worker-settings-override.test.ts`

## Task 7: Middleware Hardening

### Implementation

Update `packages/server/engine/src/lib/plugins/piece-invocation-middleware.ts` to support the external contract:

- structured matcher forms:
  - `{ pieceName: string }`,
  - `{ pieceName: string[] }`,
  - `{ pieceNamePattern: string }`,
  - function matcher receiving the full `PieceInvocationContext`,
- legacy string and `RegExp` matchers for compatibility with current tests,
- full invocation context in matcher evaluation,
- hook failure policy:
  - plugin-level default `hookFailurePolicy`,
  - middleware-level override,
  - default `fail-invocation`,
- timeout policy:
  - global default from `AP_ENGINE_PLUGIN_HOOK_TIMEOUT_MS`,
  - max cap from `AP_ENGINE_PLUGIN_HOOK_MAX_TIMEOUT_MS`,
  - per-middleware `timeoutMs`,
  - timeout follows hook failure policy,
- observe-only phases continue to ignore returned replacements,
- middleware still cannot convert a failed piece invocation into a successful one.

Extend `PieceInvocationContext` population in current call sites:

- `packages/server/engine/src/lib/handler/piece-executor.ts`
- `packages/server/engine/src/lib/helper/trigger-helper.ts`
- `packages/server/engine/src/lib/helper/piece-helper.ts`

Add where available:

- `runEnvironment`,
- `executionType`,
- `canReplaceInput` and `canReplaceOutput` on before/after hook contexts.

`EngineConstants` already carries `runEnvironment`. Add `executionType` to `EngineConstants` for flow executions instead of recomputing it ad hoc in each piece callback path.

### Tests

Extend `packages/server/engine/test/plugins/piece-invocation-middleware.test.ts`:

- structured exact matcher,
- structured array matcher,
- structured regex string matcher,
- function matcher receives full context,
- invalid pattern is rejected at registration or loader validation,
- middleware-level failure policy overrides plugin-level default,
- `fail-invocation` propagates hook errors,
- `log-and-continue` logs hook errors and continues,
- timeout with `fail-invocation` fails the invocation,
- timeout with `log-and-continue` continues,
- per-middleware timeout is capped by max timeout,
- after hooks on a piece error cannot replace the failed result into success.

Extend integration-ish engine tests:

- `flow-piece.test.ts` verifies `runEnvironment` and `executionType` on `action.run` and `action.test`,
- `trigger-helper-middleware.test.ts` verifies context on trigger phases,
- `piece-helper-middleware.test.ts` verifies context on dynamic property/auth/metadata phases.

### Local Verification

- `npm run test --workspace=packages/server/engine -- test/plugins/piece-invocation-middleware.test.ts`
- `npm run test --workspace=packages/server/engine -- test/handler/flow-piece.test.ts`
- `npm run test --workspace=packages/server/engine -- test/helper/piece-helper-middleware.test.ts test/helper/trigger-helper-middleware.test.ts`

## Task 8: Example Redaction Plugin And End-To-End Fixture

### Implementation

Create a real example Engine Plugin package plus a minimal test fixture that proves external package loading works. The example should be useful enough for operators and plugin authors to copy.

Example package path:

- `packages/plugins/example/redact-input-strings/package.json`
- `packages/plugins/example/redact-input-strings/src/index.ts`
- `packages/plugins/example/redact-input-strings/README.md`
- `packages/plugins/example/redact-input-strings/tsconfig.json`

The package should compile to JavaScript and export an `EnginePluginFactory`. It should not rely on TypeScript execution at runtime.

The example plugin behavior:

- reads a configured set of regular expressions from its plugin `config`,
- optionally scopes middleware to configured piece names, with `@activepieces/piece-ai` as the README example,
- when a replaceable piece run/test phase executes, recursively walks the input object,
- replaces matches in every string value with the literal string `REDACTED`,
- returns a replacement input object instead of mutating the original input,
- leaves non-string values unchanged,
- logs only rule names/counts, never original matched values or the full input,
- defaults `hookFailurePolicy` to `fail-invocation` because this is a policy/safety plugin.

Recommended plugin config schema:

```json
{
  "pieceNames": ["@activepieces/piece-ai"],
  "rules": [
    {
      "name": "us-ssn",
      "pattern": "\\b\\d{3}-\\d{2}-\\d{4}\\b",
      "flags": "g"
    }
  ]
}
```

Example `AP_ENGINE_PLUGINS` entry:

```json
[
  {
    "packageName": "@activepieces/engine-plugin-redact-input-strings",
    "exportName": "enginePlugin",
    "failurePolicy": "fail-startup",
    "config": {
      "pieceNames": ["@activepieces/piece-ai"],
      "rules": [
        {
          "name": "us-ssn",
          "pattern": "\\b\\d{3}-\\d{2}-\\d{4}\\b",
          "flags": "g"
        }
      ]
    }
  }
]
```

Document that this configuration prevents a prompt such as `Summarize SSN 123-45-6789` from being sent to the AI piece with the social security number intact; the AI piece should receive `Summarize SSN REDACTED`.

Implementation details for the example plugin:

- validate `config` inside the plugin package, ideally with Zod bundled by the package,
- compile every configured regexp during factory creation so invalid patterns fail at plugin load,
- support only safe regexp flags (`g`, `i`, `m`, `s`, `u`, `y`) and add `g` when omitted so all matches are replaced,
- use a pure recursive helper that returns the original value when no redaction is needed and a copied object/array only when a child changes,
- handle arrays and plain objects,
- avoid traversing functions, buffers, dates, streams, and class instances,
- guard traversal depth and total visited nodes to prevent pathological inputs from hanging execution,
- use the public `PieceInvocationContext` to ensure redaction only runs for configured piece names and replaceable phases.

Keep a smaller compiled fixture package for loader tests if importing the example package would make tests slower or require an extra build step.

Possible fixture path:

- `packages/server/engine/test/fixtures/external-engine-plugin/package.json`
- `packages/server/engine/test/fixtures/external-engine-plugin/dist/index.js`

The fixture or example package used by tests should export a factory that:

- declares the current `ENGINE_PLUGIN_API_VERSION`,
- registers middleware matching `@activepieces/piece-data-mapper` or `@activepieces/piece-ai`,
- redacts a deterministic string pattern from action input,
- records load metadata without requiring network or database access.

### Tests

Add an engine or worker-level test proving a real package path config works:

- set `AP_ENGINE_PLUGINS` to the fixture package,
- start the loader,
- execute a data-mapper or AI-piece action input containing `123-45-6789`,
- assert the piece receives `REDACTED` instead of the original social security number,
- assert the original input object is not mutated,
- assert nested object and array string values are redacted,
- assert non-matching strings and non-string values are preserved,
- assert malformed regexp config fails plugin load,
- assert configured `pieceNames` prevents redaction on non-matching pieces,
- run with no config and assert current behavior is unchanged.

If a full sandbox process test is too expensive, keep the first test at engine level and cover sandbox env propagation in Unit 6. Add a follow-up integration test only if the test runtime remains stable.

### Local Verification

- `npm run test --workspace=packages/server/engine -- test/plugins/engine-plugin-loader.test.ts test/handler/flow-piece.test.ts`
- Build the example plugin and inspect its generated `dist/index.js` to confirm it contains compiled JavaScript and no TypeScript runtime requirement.

## Task 9: Observability And Worker Health Metadata

### Implementation

Start with the engine's existing stdout/stderr path:

- loader logs:
  - plugin load started,
  - plugin loaded,
  - plugin skipped,
  - plugin load failed,
  - compact compatibility report,
- middleware runner logs:
  - hook matched,
  - hook completed,
  - hook failed,
  - hook timed out.

Use structured JSON objects passed to `console.info`, `console.warn`, or `console.error`. Avoid logging plugin config.

Add loaded plugin metadata to worker-visible machine information:

- `packages/core/execution/src/lib/workers/index.ts`
  - add `enginePlugins` metadata to `WorkerProps` or `SandboxInformation`, depending on which is easiest to populate without RPC churn.
- `packages/server/worker/src/lib/worker.ts`
  - include loaded plugin metadata if it is available from sandbox executors.

Important constraint: the long-lived worker does not currently know the in-process engine registry inside a sandbox. For the first cut, the easiest supportable option is to expose configured plugin package names and versions from worker settings, and later enhance runtime executors to report actual loaded metadata from engine startup.

Add true wide events as a separate sub-unit only after the stdout/stderr logs work. Engine does not currently initialize the API/worker evlog logger, so wide events require an explicit bridge or worker-side parsing/enrichment.

### Tests

- loader logs include package name, plugin name, version, api version, status, and failure policy,
- logs never include raw `config`,
- worker props include configured plugin metadata or an explicitly documented placeholder,
- no-config worker props remain backward-compatible.

### Local Verification

- `npm run test --workspace=packages/server/engine -- test/plugins/engine-plugin-loader.test.ts`
- `npm run test --workspace=packages/server/worker -- test/lib/worker.test.ts`
- `npm run test-unit --workspace=packages/server/api -- test/unit/app/workers/machine`

## Task 10: Documentation And Feature Registry

### Implementation

Update docs after the implementation units are complete:

- `packages/server/engine/README.md`
  - describe external Engine Plugins,
  - show package contract,
  - show `AP_ENGINE_PLUGINS`,
  - link to the input-redaction example plugin,
  - document failure and timeout policies,
  - document static-install requirement.
- `packages/plugins/example/redact-input-strings/README.md`
  - explain config-driven regexp redaction,
  - show the SSN-to-`REDACTED` AI-piece example,
  - state that regexp config may be sensitive and should not be logged,
  - warn that regexp-based PII prevention is a defense-in-depth control, not a complete data-loss-prevention system.
- `.agents/features/pieces.md`
  - update middleware section to mention external Engine Plugins when configured.
- `.agents/features/flow-runs.md`
  - update execution behavior around hook failures/timeouts.
- `.agents/features/workers.md`
  - update `WorkerSettingsResponse`, sandbox env propagation, and worker metadata.
- Optional new `.agents/features/engine-plugins.md`
  - use this if the feature is broad enough to stand apart from pieces.
- `.agents/features/GLOSSARY.md`
  - add canonical terms:
    - Engine Plugin,
    - Plugin Package,
    - Plugin Loader,
    - Plugin Registry,
    - Plugin Capability.

### Tests

Documentation has no runtime tests. Verify with:

- `rg -n "Engine Plugin|AP_ENGINE_PLUGINS|PieceInvocationMiddleware" packages/server/engine/README.md .agents/features`
- `npm run lint-dev`

## Task 11: Optional Plugin Installer, Deferred

Do not implement this in the first cut.

If static image-installed packages are not sufficient later, add a separate design and implementation plan for:

- `EnginePluginPackage` descriptor separate from `PiecePackage`,
- cache path under `common/plugins`,
- exact-version package installation,
- atomic ready markers,
- rollback on failed install,
- package-name validation,
- no shared workspace with `pieces/**` unless intentionally designed.

This unit would need its own sandbox-pool tests and probably a security review because it introduces runtime package installation.

## Suggested Implementation Order

1. Unit 1: public contract.
2. Unit 2: registry hardening and type adoption.
3. Unit 3: loader.
4. Unit 4: async startup.
5. Unit 5: API system props and worker settings.
6. Unit 6: sandbox env propagation.
7. Unit 7: middleware hardening.
8. Unit 8: example redaction plugin and end-to-end fixture.
9. Unit 9: observability and health metadata.
10. Unit 10: docs and feature registry.

This order keeps each change independently testable and avoids pushing config into the sandbox before the engine can load it.

## Regression Matrix

Run these before considering the implementation complete:

- `npm run test --workspace=packages/server/engine -- test/plugins`
- `npm run test --workspace=packages/server/engine -- test/handler/flow-piece.test.ts`
- `npm run test --workspace=packages/server/engine -- test/helper/piece-helper-middleware.test.ts test/helper/trigger-helper-middleware.test.ts`
- `npx turbo run test --filter=@activepieces/core-execution`
- `npx turbo run test --filter=@activepieces/sandbox-pool`
- `npm run test --workspace=packages/server/worker -- test/lib/worker-settings-override.test.ts`
- `npm run test-unit --workspace=packages/server/api -- test/unit/app/workers/machine/machine-service.test.ts`
- `npm run lint-dev`

If API startup validation changes are broad, also run:

- `npm run test-api`

## Manual Smoke Tests

1. No plugin config:
   - unset `AP_ENGINE_PLUGINS`,
   - run a simple flow with `@activepieces/piece-data-mapper`,
   - verify output matches current behavior.
2. Static redaction plugin:
   - install or mount the fixture package in a place the sandbox can resolve,
   - set compact one-line `AP_ENGINE_PLUGINS`,
   - start worker and engine,
   - verify startup logs show the plugin loaded,
   - run a flow with an AI piece input containing `123-45-6789`,
   - verify the AI piece receives `REDACTED` instead of the social security number.
3. Failed plugin with default policy:
   - configure a missing package,
   - verify the engine exits before accepting work.
4. Failed plugin with `skip-plugin`:
   - configure the same missing package with `failurePolicy: "skip-plugin"`,
   - verify the engine starts and logs the skip.
5. Timeout policy:
   - configure a fixture hook that sleeps beyond the timeout,
   - verify `fail-invocation` fails the piece invocation,
   - verify `log-and-continue` lets the piece invocation continue.

## Open Questions To Resolve Before Coding

1. Should `skip-plugin` ship in the first implementation, or should all configured load failures fail startup until operators ask for partial startup?
2. Should `log-and-continue` ship in the first implementation, or should hook failures always fail invocation until observability plugins prove the need?
3. Should plugin config support secret values directly, or should config only reference separate environment variables read by the plugin package?
4. Should Cloud ever support operator-provided plugins, or only internally deployed plugins?
5. Should worker health show configured plugin packages first, then actual loaded plugin descriptors later, or should the first implementation wait until actual engine-loaded metadata can be reported?

## Definition Of Done

- Existing no-plugin execution behavior is unchanged.
- Plugin packages can be authored against `@activepieces/core-execution`.
- Each engine process loads configured plugin packages before opening the worker socket.
- API validates plugin config before workers begin processing jobs.
- Worker settings and sandbox env carry plugin config through all local execution modes.
- Middleware failures and timeouts are deterministic and tested.
- Plugin config is never logged.
- Tenant-scoped metadata is available to hooks where known.
- No plugin DB entities, routes, marketplace, UI, or piece metadata rows are added.
- Feature docs and engine README reflect the implemented behavior.
- `npm run lint-dev` passes.
