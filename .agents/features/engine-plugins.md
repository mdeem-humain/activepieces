# Engine Plugins

## Summary
Engine Plugins are operator-installed Node packages loaded by the engine at startup to register runtime capabilities such as piece invocation middleware. They are configured through `AP_ENGINE_PLUGINS`, kept in a process-local registry, and must be statically installed wherever engine processes run.

## Key Files
- `packages/core/execution/src/lib/engine/plugins.ts` — public plugin contract, config schemas, API version, hook timeout defaults, and shared types
- `packages/server/engine/src/lib/plugins/engine-plugin-loader.ts` — parses `AP_ENGINE_PLUGINS`, imports package exports, validates descriptors, and applies package load failure policy
- `packages/server/engine/src/lib/plugins/engine-plugins.ts` — process-local plugin registry and plugin metadata
- `packages/server/engine/src/lib/plugins/piece-invocation-middleware.ts` — piece callback hook runner, matching, hook failure policy, and timeout handling
- `packages/server/engine/README.md` — operator-facing package contract and configuration documentation
- `packages/plugins/example/redact-input-strings/` — example Engine Plugin package
- `packages/core/execution/src/lib/workers/index.ts` — `WorkerSettingsResponse` contract re-exported through `@activepieces/shared`
- `packages/server/api/src/app/workers/machine/machine-service.ts` — sends engine plugin settings to connected workers
- `packages/server/sandbox-pool/src/lib/create-sandbox-for-job.ts` — propagates engine plugin environment variables into sandboxed engine processes

## Edition Availability
All editions. Engine Plugins are configured by deployment operators and are not gated by plan features.

## Domain Terms
- [Engine Plugin](./GLOSSARY.md) — operator-installed runtime extension loaded by the engine.
- [Plugin Package](./GLOSSARY.md) — statically installed Node package referenced by `AP_ENGINE_PLUGINS`.
- [Plugin Loader](./GLOSSARY.md) — startup component that imports and validates plugin packages.
- [Plugin Registry](./GLOSSARY.md) — process-local registry of loaded engine plugins and capabilities.
- [Plugin Capability](./GLOSSARY.md) — feature exposed by a plugin, currently piece invocation middleware.
