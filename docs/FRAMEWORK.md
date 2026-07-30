# Execution Kernel & Framework

The reusable supervisor bootstrap ships as the workspace package **`@personal-assistant/supervisor-framework`** (`packages/supervisor-framework/`). It contains the LangGraph execution kernel (`src/core/`), pack bootstrap (`src/framework/`), and capability catalog (`src/capabilities/`).

Product-specific domains (Obsidian, finance) live in `apps/personal-assistant/`. **System admin** (cron jobs, skill catalog, runtime agent CRUD) is an opt-in framework kit under `packages/supervisor-framework/src/framework/system-agent/` — not a product domain. Product wording (prompts, skill XML) stays in the app.

## Monorepo layers

| Layer | Path | Responsibility |
|---|---|---|
| Framework package | `packages/supervisor-framework/` | Agent definitions, graph execution, policies API, `bootstrapSupervisorSystem`, `resolveAgentTools` |
| Personal app | `apps/personal-assistant/src/composition/` + `src/policies/` | Composition, `createSupervisorSystem`, product runtime policy |
| Domain runtime | `apps/personal-assistant/src/runtime-agents/` | Tool factories, capability IDs, optional feature hooks/types |
| Agent prompts | `apps/personal-assistant/src/prompts/load.ts` + `data/prompts/` | System prompt loading and metadata helpers |
| Skills runtime | `packages/supervisor-framework/src/core/skills/` | Skill filesystem I/O, `SkillCatalog`, prompt enrichment, attachments |
| Cron runtime | `packages/supervisor-framework/src/framework/cron/` | Job definitions, JSON persistence, trigger protocol, scheduler service, graph runner |
| Runtime agent watcher | `packages/supervisor-framework/src/framework/runtime-agent-watcher.ts` | Debounced hot-reload when `runtime-agents.json` changes |
| Prompt logging | `packages/supervisor-framework/src/framework/logging/file-prompt-logger.ts` | Optional file-backed `PromptLoggingHook` adapter |

## Intentional boundaries

- `packages/supervisor-framework/src/core/` — execution kernel only. Must not import app or product integrations.
- `packages/supervisor-framework/src/framework/` — orchestration only. May import `core` and `capabilities`.
- `apps/personal-assistant/src/composition/` — pack bootstrap and runtime execution wiring. Imports `@personal-assistant/supervisor-framework` and `runtime-agents/`.
- `apps/personal-assistant/src/policies/` — system-configuration and default runtime policy (no product registries).
- `apps/personal-assistant/src/runtime-agents/` — feature tools and contracts. Must **not** import `src/composition/`, `src/policies/`, or `src/integrations/`.
- `apps/personal-assistant/src/composition/` must not be imported by `src/policies/` (hard rule).

Boundary tests:

- Framework: `packages/supervisor-framework/tests/unit/framework-boundary.test.ts`
- App: `apps/personal-assistant/tests/unit/app-boundary.test.ts`

## Framework API (client and personal packs)

Import from `@personal-assistant/supervisor-framework`:

- `bootstrapSupervisorSystem` — one-shot pack bootstrap (graph compile)
- `createSupervisorRuntime` — long-lived runtime shell: shared checkpointer (pack-supplied or `MemorySaver`), stable cron repo with live target-route validation, serialized soft recompile
- `createCheckpointer` pack hook — supply `BaseCheckpointSaver` (e.g. `@langchain/langgraph-checkpoint-sqlite` or Postgres) after adapters are ready
- `CronRunLedger` — optional durable cron overlap guard; wire into `createCronRunner({ ledger })`
- `resolveAgentTools` — catalog-based tool resolution
- `createAssistant`, `createAgentPolicy` — graph and policy helpers
- Defaults: `createNoopCronJobRepository`, `createEmptySkillCatalog`
- Types: `SupervisorPackBootstrap`, `SupervisorPaths`, `CompiledSupervisorGraph`, `RuntimeAgentDefinition`, `CapabilityCatalog`
- System admin (opt-in): `systemAgent` pack option, `wrapRepositoryWithSystemAgent`, `createSystemConfigCapabilityProviders`, `hasSystemConfigWriteCapability` / `resolveSystemConfigDeps`, `SYSTEM_AGENT_ID` (`"configuration"`)
- Read-only persistence (multi-process): `createReadOnlyRuntimeAgentRepository`, `createReadOnlyCronJobRepository` — mutating methods throw with a clear error; use when a second process must read shared JSON without writing
- Persisted agent validation: `validatePersistedAgentCapabilities` — fail-fast grantability check at bootstrap/recompile
- Destructive delete helpers: `buildDeleteSkillConfirmToken`, `buildDeleteRuntimeAgentConfirmToken`, `buildDeleteCronJobConfirmToken`, `requireDestructiveConfirmToken`
- Process lock: `acquireProcessLock`, `ProcessLockError` — exclusive lock file for cross-process singleton guards (scheduler uses `data/.scheduler-lock`)
- Logging: `Logger`, `createConsoleLogger`, `createFileLogger`, `createCompositeLogger`, `getLogger`, `setLogger`

Optional bootstrap hooks (omit for minimal packs):

- `config.allowDataWrites?: boolean` on `SupervisorPaths` — when `false`, bootstrap skips `initializeDefaults` (default `true`). Personal app sets this from `dataWriteRole: "writer" | "reader"` at the entrypoint.

- `createRuntimeAgentRepository(config)` — defaults to file-backed JSON repo
- `createCronJobRepository(...)` — defaults to in-memory no-op
- `buildSkillCatalog(agents)` — defaults to empty catalog
- `systemAgent?: SystemAgentOptions | false` — when set, bootstrap wires virtual admin agent repo wrap and merged `system-config` capabilities
- `buildCapabilityProviders(ctx)` — preferred catalog source; invoked after `setupAdapters` on **every** bootstrap so providers can close over fresh adapter clients (soft-recompile safe). Merged with system-config when `systemAgent` is enabled.
- `capabilityCatalog` — escape hatch for minimal packs/tests that supply a pre-built catalog. Exactly one of `buildCapabilityProviders` or `capabilityCatalog` is required.
- `buildRuntimeExecution(agents, skillCatalog, ctx)` — pack hook that returns `loadPromptByKey`, `runtimeAgentPolicy`, and optional shell formatters; use `ctx.capabilityCatalog` (personal pack uses `buildAppRuntimeExecution()`)

Personal deployment adds product wiring via `createSupervisorSystem()` in [`apps/personal-assistant/src/composition/create-supervisor-system.ts`](../apps/personal-assistant/src/composition/create-supervisor-system.ts), which delegates lifecycle concerns to `createSupervisorRuntime()`.

## Composition entry points

**Personal deployment:** `createSupervisorSystem()` wraps `createSupervisorRuntime(buildPersonalSupervisorPack(...))` with Telegram/scheduler-specific adapter hooks.

**Long-lived runtime:** `createSupervisorRuntime(pack)` — use when the process supports soft recompile (file watcher). Owns shared checkpointer (via `createCheckpointer` or default `MemorySaver`), stable cron repository, and serialized recompile.

**Persistent checkpoints:** Implement `createCheckpointer` on the pack to return any LangGraph `BaseCheckpointSaver`. The personal app uses SQLite (`@langchain/langgraph-checkpoint-sqlite`); other deployments may use `@langchain/langgraph-checkpoint-postgres` `PostgresSaver` instead.

**Pack bootstrap:** `bootstrapSupervisorSystem()` — pass capability catalog, seed agents, `buildRuntimeExecution` (returns `runtimeAgentPolicy` via `createAgentPolicy`), and optional cron/skills/repo hooks. For tests or advanced compile-only wiring, `createAssistant()` is the lower-level entry (bootstrap wraps it).

## Adding a capability (personal app)

Canonical checklist (tools-only vs tools+hooks): [RUNTIME_AGENT_SETUP.md — Beyond chat](./RUNTIME_AGENT_SETUP.md#beyond-chat-new-tool-domains-rare).

Minimum for tools-only:

1. `runtime-agents/<feature>/tools.ts` (capability ID + tool factory); optional adjacent `types.ts` and `integrations/` client.
2. One `CapabilityProvider` entry in `buildPersonalCapabilityProviders` (`personal-pack.ts`).
3. Grant via chat (or `reservedForAgentIds` on the descriptor).

For LLM-turn hooks, add `hooks.ts` and one adjacent hook branch in composition (`personal-runtime-policy.ts`). Do not add a binder, ports folder, or behavior registry.

## Graph composition walkthrough

See [examples/minimal-supervisor-system.md](../examples/minimal-supervisor-system.md) and [docs/PACK_DEVELOPMENT.md](./PACK_DEVELOPMENT.md).
