# Phase B: Config slices and pack extract

## Goal

Reduce the highest-severity coupling hubs left after Phase A without changing runtime behavior:

- Type-only `AppConfig` slices for narrower call sites
- Move-only extract of `buildPersonalCapabilityProviders` into an adjacent composition helper
- Optional: framework internal leaf imports for capabilities (public barrel kept)

Target: same soft-recompile, writer/reader, grant, and system-agent semantics; lower fan-in/fan-out at config and pack.

## Guardrails (unchanged)

From [SIMPLIFICATION_PLAN.md](./SIMPLIFICATION_PLAN.md):

- One composition root (`personal-pack.ts` remains the public pack entry)
- No `composition/domains/`, app `ports/`, behavior registries, or provider registries
- No product fields on `AppRuntimeExecutionOptions`
- Persisted capability ID strings, grant semantics, and system-agent tools unchanged

## Step 1: Config slices (types only)

Named slice interfaces live next to `AppConfig` in `apps/personal-assistant/src/config.ts`
(`TelegramConfig`, `ModelConfig`, `ObsidianConfig`, `PersistenceConfig`, `LoggingConfig`,
`McpReconnectConfig`, `SupabaseConfig`, `WiseConfig`, `SchedulerPathsConfig`).

`AppConfig` extends those slices. A single `loadConfig()` still assembles one object.
Integrations and leaf helpers take the narrowest slice; pack bootstrap may keep `AppConfig`.

## Step 2: Pack extract (move-only)

`buildPersonalCapabilityProviders` lives in
`apps/personal-assistant/src/composition/personal-capability-providers.ts` and is
**re-exported** from `personal-pack.ts` so authoring docs
([RUNTIME_AGENT_SETUP.md](./RUNTIME_AGENT_SETUP.md)) still point at one registration site.

Tools-only features still require exactly one provider entry in that function.

## Step 3: Capabilities leaf imports (optional cleanup)

Framework modules under `packages/supervisor-framework/src/framework/` import
`capabilities/catalog.js` / `capabilities/types.js` directly instead of
`capabilities/index.js`. The package root barrel still re-exports the capabilities barrel.

## Acceptance criteria

- `buildPersonalCapabilityProviders` exported from `personal-pack.ts`
- Exactly one place to add a tools-only provider entry (no new registration layer)
- `loadConfig()` signature and required env vars unchanged
- Writer bot vs reader scheduler (`allowDataWrites` / Supabase sessions) unchanged
- Soft-recompile rebuilds providers from fresh adapters/config
- Unit tests, `pnpm depcruise`, and `pnpm check` pass

## Explicitly deferred (Phase C)

- Framework `package.json` subpath exports (root barrel split)
- Splitting `core/types/agent.ts`
- Workspace-only cruise config beyond existing layer rules

## Verification

```bash
pnpm --filter @personal-assistant/supervisor-framework test:unit
pnpm --filter personal-assistant test:unit
pnpm depcruise
pnpm check
```
